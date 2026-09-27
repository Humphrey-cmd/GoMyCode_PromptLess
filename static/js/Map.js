// Ledger Snapper — Map.js
// Restores full map features: place search autocomplete dropdown, GPS, 
// map-click pinning, route drawing, zoom labels, and store cards.

mapboxgl.accessToken = MAPBOX_TOKEN;

let currentLng = 36.8219; 
let currentLat = -1.2921;
let userMarker = null; 
let currentStoreMarkers = []; 
let activePopup = null;

// --- 1. INITIALIZE MAP ---
const map = new mapboxgl.Map({
  container: 'map', 
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [currentLng, currentLat], 
  zoom: 12.5,
  pitch: 35 
});
window.map = map;

// Zoom logic: toggles marker labels via CSS
map.on('zoom', () => {
  if (map.getZoom() >= 14) {
    document.body.classList.add('map-zoomed-in');
  } else {
    document.body.classList.remove('map-zoomed-in');
  }
});

// --- 2. USER LOCATION & GPS ---
function updateSearchCenter(lng, lat) {
  currentLng = lng;
  currentLat = lat;
  
  if (userMarker) userMarker.remove();
  
  // Custom pulsing GPS pin
  const userEl = document.createElement('div');
  userEl.innerHTML = `
    <div style="width:24px;height:24px;background:rgba(239,68,68,0.25);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:pulse 2s infinite;">
      <div style="width:12px;height:12px;background:#EF4444;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>
    </div>
  `;
  userMarker = new mapboxgl.Marker(userEl).setLngLat([lng, lat]).addTo(map);

  const startInput = document.getElementById('route-start');
  if (startInput) startInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

window.triggerGPS = function() {
  const searchInp = document.getElementById('search-input');
  if (searchInp) searchInp.value = "Locating...";
  
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (searchInp) searchInp.value = "Current GPS Location";
        updateSearchCenter(pos.coords.longitude, pos.coords.latitude);
        map.flyTo({ center: [currentLng, currentLat], zoom: 14 }); 
      },
      () => { 
        if (searchInp) searchInp.value = "Location Access Denied"; 
        alert("Location access denied. Please grant location permissions or click the map.");
      },
      { timeout: 7000 }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
};

// Click anywhere on map to set starting point
map.on('click', (e) => {
  if (e.originalEvent.target.closest('.mapboxgl-popup') || e.originalEvent.target.closest('.mapboxgl-marker')) return;
  const searchInp = document.getElementById('search-input');
  if (searchInp) searchInp.value = "Custom Pin Location";
  updateSearchCenter(e.lngLat.lng, e.lngLat.lat);
});

// --- 3. PLACE SEARCH AUTOCOMPLETE DROPDOWN ---
const searchInput = document.getElementById('search-input');
const searchSuggestions = document.getElementById('search-suggestions');
let locationTimeout; 

function renderLocationDropdown(features = []) {
  if (!searchSuggestions) return;
  searchSuggestions.innerHTML = '';
  
  if (features.length > 0) {
    features.forEach(feature => {
      const div = document.createElement('div');
      div.className = 'px-4 py-2.5 hover:bg-emerald-50 cursor-pointer border-b border-slate-100 text-[13px] text-slate-800 transition-colors';
      div.innerText = feature.place_name;
      div.addEventListener('click', () => {
        if (searchInput) searchInput.value = feature.place_name; 
        searchSuggestions.classList.add('hidden'); 
        updateSearchCenter(feature.center[0], feature.center[1]);
        map.flyTo({ center: [feature.center[0], feature.center[1]], zoom: 14 }); 
      });
      searchSuggestions.appendChild(div);
    });
  } else if (searchInput && searchInput.value.length >= 3) {
    const noRes = document.createElement('div');
    noRes.className = 'px-4 py-3 text-[12px] text-slate-500 italic bg-slate-50';
    noRes.innerText = "Location not found. Click the map to drop a pin.";
    searchSuggestions.appendChild(noRes);
  }
  
  if (searchSuggestions.innerHTML !== '') {
    searchSuggestions.classList.remove('hidden');
  }
}

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(locationTimeout); 
    const query = e.target.value.trim();
    if (query.length < 3) { 
      if (searchSuggestions) searchSuggestions.classList.add('hidden'); 
      return; 
    }

    locationTimeout = setTimeout(async () => {
      try {
        const mapboxPromise = fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&country=ke&proximity=${currentLng},${currentLat}&autocomplete=true&limit=5`
        ).then(res => res.json()).catch(() => ({ features: [] }));

        const photonPromise = fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${currentLat}&lon=${currentLng}&limit=5`
        ).then(res => res.json()).catch(() => ({ features: [] }));

        const [mbData, photonData] = await Promise.all([mapboxPromise, photonPromise]);
        let combined = [];

        if (mbData.features) combined.push(...mbData.features);
        if (photonData.features) {
          const photonFeatures = photonData.features.filter(f => f.properties.name).map(f => {
            const name = f.properties.name;
            const loc = f.properties.district || f.properties.city || "";
            return { place_name: loc ? `${name}, ${loc}` : name, center: f.geometry.coordinates };
          });
          combined.push(...photonFeatures);
        }

        // Deduplicate
        const unique = [];
        const seen = new Set();
        for (const feat of combined) {
          const base = feat.place_name.split(',')[0].toLowerCase().trim();
          if (!seen.has(base)) { 
            seen.add(base); 
            unique.push(feat); 
          }
        }
        renderLocationDropdown(unique.slice(0, 6));
      } catch (err) {
        renderLocationDropdown([]);
      }
    }, 350); 
  });
}

// Close suggestions on outside click
document.addEventListener('click', (e) => {
  if (searchInput && searchSuggestions && !searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
    searchSuggestions.classList.add('hidden');
  }
});

// --- 4. DIRECTIONS & ROUTING ---
async function drawRouteToStore(endCoords) {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${currentLng},${currentLat};${endCoords[0]},${endCoords[1]}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.routes || json.routes.length === 0) return null;

    const data = json.routes[0];
    const route = data.geometry.coordinates;
    const geojson = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } };

    if (map.getSource('store-route')) {
      map.getSource('store-route').setData(geojson);
    } else {
      map.addLayer({
        id: 'store-route', 
        type: 'line', 
        source: { type: 'geojson', data: geojson },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0F6E56', 'line-width': 5, 'line-opacity': 0.85 } 
      });
    }

    const bounds = new mapboxgl.LngLatBounds([currentLng, currentLat], [currentLng, currentLat]);
    route.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 90 });

    const distKm = (data.distance / 1000).toFixed(1);
    const mins = Math.round(data.duration / 60);
    return `${distKm} km · ${mins} min drive`;
  } catch (err) {
    return null;
  }
}

// --- 5. RENDER STORES & SIDEBAR CARDS ---
window.plotStores = function(stores) {
  currentStoreMarkers.forEach(m => m.remove());
  currentStoreMarkers = [];

  const listContainer = document.getElementById('facility-list-container');
  if (listContainer) listContainer.innerHTML = '';

  const countBadge = document.getElementById('map-record-count');
  if (countBadge) countBadge.innerText = stores.length;

  const resultsCount = document.getElementById('results-count');
  if (resultsCount) resultsCount.innerText = stores.length > 0 ? `Found ${stores.length} store deals nearby` : "No stores found.";

  const bounds = new mapboxgl.LngLatBounds();
  if (userMarker) bounds.extend([currentLng, currentLat]);

  stores.forEach((store) => {
    const coords = [store.lng, store.lat];
    bounds.extend(coords);

    // Create marker with label
    const markerEl = document.createElement('div');
    markerEl.className = 'marker-wrap cursor-pointer transition-transform hover:scale-110';
    markerEl.innerHTML = `
      <div class="marker-pin"></div>
      <div class="facility-label bg-white/95 px-2 py-0.5 rounded shadow-sm border border-slate-200 text-[10px] font-bold text-slate-800">
        ${store.store_name}
      </div>
    `;

    // Interactive popup
    const popup = new mapboxgl.Popup({ offset: 25, closeButton: true, maxWidth: '280px' });
    popup.setHTML(`
      <div style="padding:14px; font-family:'Plus Jakarta Sans',sans-serif;">
        <h3 style="margin:0 0 4px; font-size:14px; font-weight:800; color:#09261e;">${store.store_name}</h3>
        <p style="margin:0 0 6px; font-size:11px; font-weight:600; color:#64748b;">
          Brand: <span style="color:#0F6E56; font-weight:700;">${store.product_brand}</span>
        </p>
        <p style="margin:0 0 10px; font-size:16px; font-weight:800; color:#0F6E56;">${store.price}</p>
        <button onclick="drawRouteToStore([${store.lng}, ${store.lat}])" 
                style="width:100%; height:32px; background:#0F6E56; color:white; border:none; border-radius:8px; font-size:11px; font-weight:800; cursor:pointer; text-transform:uppercase; letter-spacing:0.05em;">
          Get Route Line
        </button>
      </div>
    `);

    const marker = new mapboxgl.Marker(markerEl)
      .setLngLat(coords)
      .setPopup(popup)
      .addTo(map);

    currentStoreMarkers.push(marker);

    markerEl.addEventListener('click', () => {
      map.flyTo({ center: coords, zoom: 15 });
    });

    // Create sidebar card
    if (listContainer) {
      const card = document.createElement('div');
      card.className = 'facility-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
          <h4 style="margin:0; font-size:13px; font-weight:800; color:#0f172a;">${store.store_name}</h4>
          <span style="font-size:13px; font-weight:800; color:#0F6E56;">${store.price}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span style="display:inline-block; padding:2px 8px; background:#E1F5EE; color:#0F6E56; border-radius:12px; font-size:11px; font-weight:700;">
            ${store.product_brand}
          </span>
          <button style="background:none; border:none; color:#0F6E56; font-size:11px; font-weight:800; cursor:pointer; padding:0;">
            Route &rarr;
          </button>
        </div>
      `;

      card.addEventListener('click', () => {
        map.flyTo({ center: coords, zoom: 15 });
        marker.togglePopup();
        drawRouteToStore(coords);
      });

      listContainer.appendChild(card);
    }
  });

  if (stores.length > 0) {
    map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
  }
};

// Initial position setup
map.on('load', () => {
  updateSearchCenter(currentLng, currentLat);
});