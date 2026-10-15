from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from django.contrib import messages
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.cache import never_cache
import requests
import json
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import ensure_csrf_cookie
import time

logger = logging.getLogger(__name__)

def home(request):
    return render(request, "home.html")

def register(request):

    if request.method == "POST":

        username = request.POST.get("username")
        email = request.POST.get("email")
        password = request.POST.get("password")
        confirm_password = request.POST.get("confirmPassword")

        # Check if email format is valid
        try:
            validate_email(email)
        except ValidationError:
            messages.error(request, "Enter a valid email address.")
            return redirect("home_view")

        # Check if passwords match
        if password != confirm_password:
            messages.error(request, "Passwords do not match.")
            return redirect("home_view")
        # Check if username already exists
        if User.objects.filter(username=username).exists():
            messages.error(request, "Username already exists.")
            return redirect("home_view")

        # Check if email already exists
        if User.objects.filter(email=email).exists():
            messages.error(request, "Email already exists.")
            return redirect("home_view")

        # Create the user
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password
        )

        # Log the user in immediately
        return redirect('login_view')
    
    return render(request,"register.html")

def user_login(request):

    if request.method == "POST":

        username = request.POST.get("username")
        password = request.POST.get("password")

        user = authenticate(
            request,
            username=username,
            password=password
        )

        if user is not None:
            login(request, user)
            return redirect("dashboard")

        messages.error(request, "Invalid username or password.")
        return redirect("home_view")

    return render(request,"login.html")

@ensure_csrf_cookie
def dashboard(request):
    return render(request, "dashboard.html")

@never_cache
def frontend_config(request):
    js = (
        f'const MAPBOX_TOKEN = "{settings.MAPBOX_TOKEN}";\n'
        f'const GEMINI_API_KEY = "{settings.GEMINI_API_KEY}";\n'
    )
    return HttpResponse(js, content_type = 'application/javascript')

PROMPT_TEMPLATE = """You are a LedgerSnap Ai, a smart retail price comparison scout in Nairobi,Kenya.
The user's location is near {area}.

{task}
{budget_clause}
Respond with ONLY a valid JSON array. Do not wrap it in '''json or'''blocks.
Each element must have this exact shape:
{{
"store_name":"Naivas Supermarket",
"product_brand":"Superloaf Bread",
"price":"KES 65",
"lat": -1.2921,
"lng": 36.8219
}}
Rules:
-Generate between 3 and 6 stores.
-Use realistic Kenyan chains : Naivas,CarreFour,Quickmart,Chandarana.Cleanshelf,local dukas.
-All prices in KES, formatted like "KES 1,500.
-Latitude between -1.20 and -1.35, longitude between 36.70 and 36.95.
-Return ONLY the JSON array.
"""

def build_prompt(query, area, budget, has_image):
    if has_image:
        task = "The user uploaded an image of a shopping list. Extract the items and find stores that sell them."
    else:
        task = f'The user is searching for: "{query}".'

    budget_clause = ""
    if budget:
        budget_clause = (
            f"CRITICAL: The user has a budget of KES {budget}. "
            f"State in the JSON whether their basket fits within this budget."
        )

    return PROMPT_TEMPLATE.format(
        area=area or "Nairobi",
        task=task,
        budget_clause=budget_clause,
    )

def call_gemini(prompt, image=None, max_retries=2):
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    parts = [{"text": prompt}]
    if image:
        parts.append({
            "inlineData": {
                "mimeType": image["mime"],
                "data": image["data"],
            }
        })

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    )

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.7},
    }

    logger.info("Calling Gemini model=%s has_image=%s", settings.GEMINI_MODEL, bool(image))

    last_error = None

    for attempt in range(max_retries + 1):
        try:
            resp = requests.post(url, json=payload, timeout=settings.SCOUT_REQUEST_TIMEOUT)
        except (requests.ConnectionError, requests.Timeout) as e:
            # Google closed the socket or we timed out — retry
            last_error = e
            logger.warning(
                "Gemini connection issue (attempt %d/%d): %s",
                attempt + 1, max_retries + 1, e,
            )
            if attempt < max_retries:
                time.sleep(2)
                continue
            raise RuntimeError(
                "Could not reach Gemini. The connection was interrupted. "
                "Please try again."
            ) from e

        # Retry on 503/429 (server overloaded / rate limited)
        if resp.status_code in (503, 429) and attempt < max_retries:
            logger.warning("Gemini %s, retrying (attempt %d)", resp.status_code, attempt + 1)
            time.sleep(2)
            continue

        if resp.status_code != 200:
            logger.error("Gemini error %s: %s", resp.status_code, resp.text[:1000])
            raise RuntimeError(f"Gemini returned {resp.status_code}: {resp.text[:200]}")

        # Success — parse and return
        data = resp.json()
        try:
            raw = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as e:
            logger.error("Bad Gemini shape: %s", json.dumps(data)[:1000])
            raise RuntimeError("Gemini returned an empty response.") from e

        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.replace("```json", "").replace("```", "").strip()

        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Non-JSON from Gemini: %s", raw[:500])
            raise RuntimeError("Gemini returned non-JSON content.") from e

    # Should never reach here — loop either returns or raises
    raise RuntimeError(f"Gemini failed after retries: {last_error}")

def call_groq(prompt, image=None, max_retries=2):
    """Call Groq. Returns parsed JSON list of stores."""
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured.")

    # Groq's text models can't process images. If one was uploaded,
    # note it in text so the model knows to ask the user to describe it.
    content = prompt
    if image:
        content += (
            "\n\nNOTE: The user uploaded an image but this model cannot see it. "
            "Generate stores based on the text query only."
        )

    # Groq REQUIRES the word "json" to appear in the messages
    # when response_format is json_object. The system prompt below handles that.
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.GROQ_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You return ONLY valid JSON. No markdown, no commentary, "
                    "no code fences. The response must be a JSON object."
                ),
            },
            {"role": "user", "content": content},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.7,
    }

    last_error = None

    for attempt in range(max_retries + 1):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=30)
        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = e
            logger.warning("Groq connection issue (attempt %d): %s", attempt + 1, e)
            if attempt < max_retries:
                time.sleep(2)
                continue
            raise RuntimeError(f"Could not reach Groq: {e}") from e

        if resp.status_code in (429, 503) and attempt < max_retries:
            logger.warning("Groq %s, retrying (attempt %d)", resp.status_code, attempt + 1)
            time.sleep(3)
            continue

        if resp.status_code != 200:
            logger.error("Groq error %s: %s", resp.status_code, resp.text[:1000])
            raise RuntimeError(f"Groq returned {resp.status_code}: {resp.text[:200]}")

        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()

        # Strip fences if the model ignored the system prompt
        if raw.startswith("```"):
            raw = raw.replace("```json", "").replace("```", "").strip()

        parsed = json.loads(raw)

        # Groq returns a JSON object (we asked for json_object mode).
        # Normalise to a list of stores — same shape call_gemini returns.
        if isinstance(parsed, dict) and "stores" in parsed:
            return parsed["stores"]
        if isinstance(parsed, list):
            return parsed

        raise RuntimeError("Groq returned unexpected shape.")

    raise RuntimeError(f"Groq failed after retries: {last_error}")

@csrf_exempt
@require_POST
def scout(request):
    try:
        body = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    query = (body.get("query") or "").strip()
    area = (body.get("area") or "Nairobi").strip()
    budget = body.get("budget")
    image = body.get("image")   # {"mime": "...", "data": "..."} or None

    if not query and not image:
        return JsonResponse({"error": "Provide a query or image."}, status=400)

    if image and (not isinstance(image, dict) or "mime" not in image or "data" not in image):
        return JsonResponse({"error": "Malformed image payload."}, status=400)

    prompt = build_prompt(query, area, budget, has_image=bool(image))

    # ---- Provider chain: Groq first, Gemini as fallback ----
    stores = None
    providers_tried = []

    # 1. Try Groq (fast, reliable, free tier)
    try:
        stores = call_groq(prompt, image=image)
        logger.warning("scout: served by Groq")
    except Exception as e:
        providers_tried.append(f"Groq: {e}")
        logger.warning("Groq failed, falling back to Gemini: %s", e)

    # 2. Fall back to Gemini (handles images, larger context)
    if stores is None:
        try:
            stores = call_gemini(prompt, image=image)
            logger.info("scout: served by Gemini (fallback)")
        except Exception as e:
            providers_tried.append(f"Gemini: {e}")
            logger.error("All AI providers failed: %s", providers_tried)

    # 3. If both failed, return a clean error
    if stores is None:
        return JsonResponse(
            {"error": "All AI services are busy right now. Please try again in a moment."},
            status=502,
        )

    # Normalise: guarantee the frontend always gets a list
    if isinstance(stores, dict) and "stores" in stores:
        stores = stores["stores"]
    if not isinstance(stores, list):
        return JsonResponse({"error": "AI returned unexpected shape."}, status=502)

    return JsonResponse({"stores": stores})