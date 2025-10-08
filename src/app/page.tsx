'use client'
import { useCallback, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import * as turf from '@turf/turf'
import osmtogeojson from 'osmtogeojson'

const LawnMap = dynamic(() => import('../components/LawnMap'), { ssr: false })

// Email submission removed; keep only address input for geocoding

export default function HomePage() {
  const [center, setCenter] = useState<[number, number]>([40.0, -89.0])
  const [polygon, setPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null)
  const [squareFeet, setSquareFeet] = useState<number | null>(null)
  const [exclusion, setExclusion] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [address, setAddress] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [autocomplete, setAutocomplete] = useState<any>(null)

  // Removed unused onPolygonChange callback

  // Initialize Google Places autocomplete
  useEffect(() => {
    const initAutocomplete = () => {
      if (typeof window !== 'undefined' && (window as any).google && (window as any).google.maps && (window as any).google.maps.places) {
        const input = document.getElementById('address-input') as HTMLInputElement
        if (input && !autocomplete) {
          console.log('Initializing Google Places autocomplete')
          const autocompleteInstance = new (window as any).google.maps.places.Autocomplete(input, {
            types: ['address'],
            componentRestrictions: { country: 'us' }
          })
          autocompleteInstance.addListener('place_changed', () => {
            const place = autocompleteInstance.getPlace()
            console.log('Place selected:', place)
            if (place.geometry?.location) {
              const lat = place.geometry.location.lat()
              const lng = place.geometry.location.lng()
              setCenter([lat, lng])
              setAddress(place.formatted_address || '')
            }
          })
          setAutocomplete(autocompleteInstance)
        }
      } else {
        // Retry after a short delay if Google Maps isn't loaded yet
        setTimeout(initAutocomplete, 100)
      }
    }
    
    // Start trying to initialize after a short delay
    const timer = setTimeout(initAutocomplete, 500)
    return () => clearTimeout(timer)
  }, [autocomplete])

  const geocode = async (address: string) => {
    if (!address || address.trim().length < 3) return
    try {
      setLocating(true)
      console.log('Geocoding address:', address)
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`)
      if (!res.ok) throw new Error('Geocoding failed')
      const data = await res.json()
      console.log('Geocode response:', data)
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat)
        const lon = parseFloat(data[0].lon)
        console.log('Setting center to:', lat, lon)
        setCenter([lat, lon])
      } else {
        alert('Address not found. Try a more specific address or use the autocomplete suggestions.')
      }
    } catch {
      alert('Could not look up that address. Please try again later.')
    } finally { setLocating(false) }
  }

  const estimate = useCallback(async () => {
    if (!polygon) return
    setLoading(true)
    try {
      const bbox = turf.bbox(polygon) // [minX, minY, maxX, maxY] -> [west, south, east, north]
      const south = bbox[1]
      const west = bbox[0]
      const north = bbox[3]
      const east = bbox[2]
      
      // Fetch buildings from OpenStreetMap
      console.log('Fetching buildings from OpenStreetMap...')
      const overpass = await fetch(`/api/buildings?bbox=${south},${west},${north},${east}`)
      let osm: { elements: unknown[] } | null = null
      try {
        osm = await overpass.json()
      } catch {}
      if (!osm || !osm.elements) {
        console.warn('Buildings API failed or empty; proceeding without building subtraction')
        osm = { elements: [] }
      }
      
      // Convert OSM to GeoJSON and filter buildings
      const gj = osmtogeojson(osm)
      const buildings: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] = []
      for (const f of gj.features) {
        if (f.properties && f.properties.building) {
          if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
            buildings.push(f)
          }
        }
      }
      console.log(`Found ${buildings.length} buildings to exclude`)
      
      // Start with the lawn polygon
      let result: GeoJSON.Feature<GeoJSON.Polygon> | null = polygon
      
      // Subtract user-drawn exclusions first (house, patios, etc.)
      if (exclusion) {
        try {
          const diff = turf.difference(result, exclusion)
          if (diff) { result = diff }
          console.log('Subtracted user-drawn exclusions')
        } catch {}
      }
      
      // Subtract all buildings from OpenStreetMap
      for (const b of buildings) {
        try {
          const diff = turf.difference(result, b)
          if (diff) { result = diff }
        } catch {}
      }
      
      // Calculate final area using turf.area() which returns square meters
      const areaSqMeters = turf.area(result || polygon)
      const sqft = areaSqMeters * 10.7639
      
      // Test: Create a simple 100m x 100m square for comparison
      const testSquare = turf.polygon([[
        [-89.0, 40.0],
        [-89.0, 40.0009], // ~100m north
        [-88.9991, 40.0009], // ~100m east  
        [-88.9991, 40.0],
        [-89.0, 40.0]
      ]])
      const testArea = turf.area(testSquare)
      console.log('Test 100m x 100m square area:', testArea, 'sq meters (should be ~10,000)')
      
      // Alternative calculation using turf.area() with proper coordinate system
      const polygonBbox = turf.bbox(result || polygon)
      const centerLat = (polygonBbox[1] + polygonBbox[3]) / 2
      const metersPerDegreeLat = 111320
      const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180)
      
      // Debug logging
      console.log('Area calculation debug:')
      console.log('- Area in sq meters (turf):', areaSqMeters)
      console.log('- Conversion factor:', 10.7639)
      console.log('- Area in sq ft:', sqft)
      console.log('- Center latitude:', centerLat)
      console.log('- Meters per degree lat:', metersPerDegreeLat)
      console.log('- Meters per degree lng:', metersPerDegreeLng)
      console.log('- Bbox:', polygonBbox)
      console.log('- Polygon coordinates sample:', JSON.stringify((result || polygon)?.geometry?.coordinates?.[0]?.slice(0, 3)))
      
      setSquareFeet(Math.round(sqft))
      console.log(`Final lawn area: ${Math.round(sqft).toLocaleString()} sq ft`)
    } finally {
      setLoading(false)
    }
  }, [polygon, exclusion])

  // Submit/email flow removed; estimation remains client-side only

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Lawn Estimator</h1>
      <p style={{ marginBottom: 12 }}>Enter an address, draw your lawn, and get a rough square footage. Buildings will be excluded automatically.</p>
      <ol style={{ margin: '0 0 16px 18px', color: '#444' }}>
        <li>Type your address (autocomplete suggestions will appear) and click Locate.</li>
        <li>Draw your lawn using the green polygon tool (top-right).</li>
        <li>Optionally draw the house/exclusions using the red polygon tool.</li>
        <li>Click the first point to finish each shape. You can edit or delete them.</li>
        <li>Click Estimate Area to calculate square footage and time estimate (exclusions are subtracted).</li>
      </ol>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, color: '#333' }}>
        <div style={{ width: 14, height: 14, background: '#2a7', border: '1px solid #1e5', borderRadius: 2 }}></div>
        <span style={{ fontSize: 14 }}>Green = Lawn area</span>
        <div style={{ width: 14, height: 14, background: '#d33', border: '1px solid #b11', borderRadius: 2, marginLeft: 16 }}></div>
        <span style={{ fontSize: 14 }}>Red = Exclusion (house, patios, etc.)</span>
      </div>
      <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input 
            id="address-input"
            name="address" 
            placeholder="Start typing address for suggestions..." 
            required 
            value={address} 
            onChange={(e) => setAddress(e.target.value)} 
            style={{ flex: 1, padding: 10, border: '1px solid #ccc', borderRadius: 6 }} 
          />
          <button type="button" onClick={() => {
            geocode(address)
          }} disabled={locating} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ccc' }}>{locating ? 'Locating…' : 'Locate'}</button>
        </div>
        <div style={{ gridColumn: '1 / -1' }}></div>
        <button type="button" onClick={estimate} disabled={!polygon || loading} style={{ 
          padding: '10px 12px', 
          borderRadius: 6, 
          border: '1px solid #ccc',
          background: loading ? '#f0f0f0' : 'white',
          color: loading ? '#666' : 'black',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {loading && (
            <div style={{
              width: 16,
              height: 16,
              border: '2px solid #ccc',
              borderTop: '2px solid #007bff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
          )}
          {loading ? 'Estimating…' : 'Estimate Area'}
        </button>
        <div style={{ alignSelf: 'center' }}>
          {squareFeet ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {squareFeet.toLocaleString()} sq ft
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                Est. time: {Math.ceil(squareFeet / 250)} minutes
              </div>
            </div>
          ) : ''}
        </div>
        <div style={{ gridColumn: '1 / -1' }}></div>
      </form>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <LawnMap center={center} onPolygonChange={setPolygon} onExclusionChange={setExclusion} />
        </div>
        <div style={{ minWidth: 200, padding: 12, background: '#f8f9fa', borderRadius: 8, border: '1px solid #dee2e6' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Drawing Tools</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 16, height: 16, background: '#2a7', border: '2px solid #1e5', borderRadius: 3 }}></div>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Green Polygon</span>
          </div>
          <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#666' }}>Draw your lawn area</p>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 16, height: 16, background: '#d33', border: '2px solid #b11', borderRadius: 3 }}></div>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Red Polygon</span>
          </div>
          <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#666' }}>Draw exclusions (house, patios)</p>
          
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>
            <p style={{ margin: '0 0 4px 0' }}>• Click polygon tool to start</p>
            <p style={{ margin: '0 0 4px 0' }}>• Click points around area</p>
            <p style={{ margin: '0' }}>• Click first point to finish</p>
          </div>
        </div>
      </div>
    </main>
  )
}
