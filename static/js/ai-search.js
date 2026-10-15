// Ledger Snapper — ai-search.js

async function callScoutApi(query, area, budget = null, image = null) {
    const res = await fetch('/api/scout/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, area, budget, image }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
        recommendation: data.recommendation || '',
        stores: data.stores || [],
    };
}

window.callScoutApi = callScoutApi;

async function findStoresForProduct(product, userAreaHint) {
    const result = await callScoutApi(product, userAreaHint);
    return result.stores;
}