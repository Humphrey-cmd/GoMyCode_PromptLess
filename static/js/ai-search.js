// Ledger Snapper — ai-search.js

// Using the required 3.8-flash model as directed by the API
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;

async function findStoresForProduct(product, userAreaHint) {
  const body = {
    contents: [{
      parts: [{
        text: `You are a retail locator demo. The user is searching for "${product}" near ${userAreaHint}. ` +
              `Generate 3 realistic retail stores or supermarkets in that area that would sell this. ` +
              `For each store, specify a realistic brand for the requested product (e.g., if they searched bread, "Supaloaf" or "Festive") and a realistic price in KES. ` +
              `Generate RANDOM coordinates within Nairobi for each store (Latitude between -1.20 and -1.35, Longitude between 36.70 and 36.95). ` +
              `Respond with ONLY a JSON array of objects. Do not include markdown formatting like \`\`\`json. ` +
              `Format: [{"store_name": "Naivas", "product_brand": "Supaloaf", "price": "50 KES", "lat": -1.2921, "lng": 36.8219}]`
      }]
    }]
  };

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini request failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      throw new Error("Gemini returned no text content");
    }

    // Strip markdown if the AI includes it anyway
    const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(cleanText); 
    
  } catch (err) {
    console.error("Fetch Error:", err);
    throw err; 
  }
}