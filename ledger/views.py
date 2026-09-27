from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from django.contrib import messages
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
import re


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

        # Simple password strength check
        if len(password) < 8:
            messages.error(request, "Password must be at least 8 characters.")
            return redirect("home_view")

        if not re.search(r"[A-Z]", password):
            messages.error(request, "Password must contain an uppercase letter.")
            return redirect("home_view")

        if not re.search(r"[0-9]", password):
            messages.error(request, "Password must contain a number.")
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

        return redirect("/?login=true")

    return redirect("home_view")
def user_login(request):

    if request.method == "POST":

        username = request.POST.get("username")
        password = request.POST.get("password")

        print("USERNAME:", username)
        print("PASSWORD:", password)

        # Temporary test: ignore authentication
        return redirect("dashboard")

    return redirect("home_view")
# def user_login(request):

#     if request.method == "POST":

#         username = request.POST.get("username")
#         password = request.POST.get("password")

#         # Check username and password against database
#         user = authenticate(
#             request,
#             username=username,
#             password=password
#         )

#         if user is not None:
#             login(request, user)
#             return redirect("dashboard")

#         messages.error(request, "Invalid username or password.")
#         return redirect("home_view")

#     return redirect("dashboard")

def dashboard(request):
    return render(request, "dashboard.html")