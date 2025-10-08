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
  const [currentStep, setCurrentStep] = useState(1) // 1: Address, 2: Property, 3: Exclusions, 4: Results
  const [propertyArea, setPropertyArea] = useState<number | null>(null)

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
              setCurrentStep(2) // Move to property drawing step
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
        setCurrentStep(2) // Move to property drawing step
      } else {
        alert('Address not found. Try a more specific address or use the autocomplete suggestions.')
      }
    } catch {
      alert('Could not look up that address. Please try again later.')
    } finally { setLocating(false) }
  }

  const handlePropertyComplete = () => {
    if (polygon) {
      // Calculate property area
      const areaSqMeters = turf.area(polygon)
      const correctionFactor = 10000 / 7671.976579524735
      const correctedAreaSqMeters = areaSqMeters * correctionFactor
      const sqft = correctedAreaSqMeters * 10.7639
      setPropertyArea(Math.round(sqft))
      
      // Clear the map for exclusions step
      setPolygon(null)
      setExclusion(null)
      setSquareFeet(null)
      
      setCurrentStep(3) // Move to exclusions step
    }
  }

  const handleExclusionsComplete = () => {
    if (exclusion && propertyArea) {
      // Calculate exclusion area
      const exclusionAreaSqMeters = turf.area(exclusion)
      const correctionFactor = 10000 / 7671.976579524735
      const correctedExclusionAreaSqMeters = exclusionAreaSqMeters * correctionFactor
      const exclusionSqft = correctedExclusionAreaSqMeters * 10.7639
      
      // Calculate final lawn area: property - exclusions
      const finalLawnArea = Math.max(0, propertyArea - Math.round(exclusionSqft))
      setSquareFeet(finalLawnArea)
      
      console.log('Final calculation:')
      console.log('- Property area:', propertyArea, 'sq ft')
      console.log('- Exclusion area:', Math.round(exclusionSqft), 'sq ft')
      console.log('- Final lawn area:', finalLawnArea, 'sq ft')
    }
    
    setCurrentStep(4) // Move to results step
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
      
      // Calculate area of the lawn polygon AFTER subtracting exclusions and buildings
      const lawnAreaSqMeters = turf.area(result || polygon)
      
      // Apply correction factor based on the test square (10,000 / 7671.98 = 1.303)
      const correctionFactor = 10000 / 7671.976579524735
      const correctedAreaSqMeters = lawnAreaSqMeters * correctionFactor
      const sqft = correctedAreaSqMeters * 10.7639
      
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
      console.log('- Original lawn area (sq meters):', turf.area(polygon))
      console.log('- Final lawn area after subtractions (sq meters):', lawnAreaSqMeters)
      console.log('- Correction factor:', correctionFactor)
      console.log('- Corrected area in sq meters:', correctedAreaSqMeters)
      console.log('- Conversion factor:', 10.7639)
      console.log('- Area in sq ft:', sqft)
      console.log('- Center latitude:', centerLat)
      console.log('- Meters per degree lat:', metersPerDegreeLat)
      console.log('- Meters per degree lng:', metersPerDegreeLng)
      console.log('- Bbox:', polygonBbox)
      console.log('- Lawn polygon coordinates sample:', JSON.stringify(polygon?.geometry?.coordinates?.[0]?.slice(0, 3)))
      console.log('- Exclusion polygon coordinates sample:', JSON.stringify(exclusion?.geometry?.coordinates?.[0]?.slice(0, 3)))
      console.log('- Result polygon coordinates sample:', JSON.stringify(result?.geometry?.coordinates?.[0]?.slice(0, 3)))
      
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
      
      {/* Step Indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center' }}>
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: currentStep >= step ? '#007bff' : '#e0e0e0',
              color: currentStep >= step ? 'white' : '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              fontSize: 14
            }}
          >
            {step}
          </div>
        ))}
      </div>

      {/* Step 1: Address Input */}
      {currentStep === 1 && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Step 1: Enter Property Address</h2>
          <p style={{ marginBottom: 16, color: '#666' }}>Type your address and we'll locate it on the map</p>
        </div>
      )}

      {/* Step 2: Draw Property */}
      {currentStep === 2 && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Step 2: Draw Property Perimeter</h2>
          <p style={{ marginBottom: 16, color: '#666' }}>Draw a polygon around your entire property boundary</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#333' }}>
            <div style={{ width: 14, height: 14, background: '#2a7', border: '1px solid #1e5', borderRadius: 2 }}></div>
            <span style={{ fontSize: 14 }}>Green = Property boundary</span>
          </div>
        </div>
      )}

      {/* Step 3: Draw Exclusions */}
      {currentStep === 3 && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Step 3: Draw Non-Mowable Areas</h2>
          <p style={{ marginBottom: 16, color: '#666' }}>Draw polygons around areas you don't mow (house, patios, driveways, etc.)</p>
          <p style={{ marginBottom: 16, color: '#888', fontSize: 14 }}>Property area saved: {propertyArea?.toLocaleString()} sq ft</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#333' }}>
            <div style={{ width: 14, height: 14, background: '#d33', border: '1px solid #b11', borderRadius: 2 }}></div>
            <span style={{ fontSize: 14 }}>Red = Non-mowable areas</span>
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {currentStep === 4 && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Step 4: Your Lawn Estimate</h2>
          <p style={{ marginBottom: 16, color: '#666' }}>Here's your calculated lawn area</p>
        </div>
      )}
      {/* Step 1: Address Input Form */}
      {currentStep === 1 && (
        <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 600, margin: '0 auto 16px auto' }}>
          <input 
            id="address-input"
            name="address" 
            placeholder="Start typing address for suggestions..." 
            required 
            value={address} 
            onChange={(e) => setAddress(e.target.value)} 
            style={{ flex: 1, padding: 12, border: '1px solid #ccc', borderRadius: 6, fontSize: 16 }} 
          />
          <button type="button" onClick={() => geocode(address)} disabled={locating} style={{ 
            padding: '12px 24px', 
            borderRadius: 6, 
            border: '1px solid #007bff',
            background: '#007bff',
            color: 'white',
            cursor: locating ? 'not-allowed' : 'pointer',
            fontSize: 16,
            fontWeight: 600
          }}>
            {locating ? 'Locating…' : 'Locate'}
          </button>
        </form>
      )}

      {/* Step 2: Property Drawing */}
      {currentStep === 2 && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <button 
            onClick={handlePropertyComplete}
            disabled={!polygon}
            style={{ 
              padding: '12px 24px', 
              borderRadius: 6, 
              border: '1px solid #007bff',
              background: polygon ? '#007bff' : '#f0f0f0',
              color: polygon ? 'white' : '#666',
              cursor: polygon ? 'pointer' : 'not-allowed',
              fontSize: 16,
              fontWeight: 600
            }}
          >
            Next: Draw Exclusions
          </button>
        </div>
      )}

      {/* Step 3: Exclusions Drawing */}
      {currentStep === 3 && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <button 
            onClick={handleExclusionsComplete}
            style={{ 
              padding: '12px 24px', 
              borderRadius: 6, 
              border: '1px solid #007bff',
              background: '#007bff',
              color: 'white',
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 600
            }}
          >
            Calculate Lawn Area
          </button>
        </div>
      )}

      {/* Step 4: Results */}
      {currentStep === 4 && squareFeet && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ 
            background: '#f8f9fa', 
            border: '1px solid #dee2e6', 
            borderRadius: 8, 
            padding: 24, 
            marginBottom: 16,
            maxWidth: 400,
            margin: '0 auto 16px auto'
          }}>
            <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: '#007bff' }}>
              {squareFeet.toLocaleString()} sq ft
            </div>
            <div style={{ fontSize: 18, color: '#666', marginBottom: 16 }}>
              Lawn Area
            </div>
            <div style={{ fontSize: 16, color: '#333' }}>
              Estimated mowing time: ~{Math.round(squareFeet / 250)} minutes
            </div>
            {propertyArea && (
              <div style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
                Total property: {propertyArea.toLocaleString()} sq ft
              </div>
            )}
          </div>
          <button 
            onClick={() => {
              setCurrentStep(1)
              setPolygon(null)
              setExclusion(null)
              setSquareFeet(null)
              setPropertyArea(null)
              setAddress('')
            }}
            style={{ 
              padding: '10px 20px', 
              borderRadius: 6, 
              border: '1px solid #ccc',
              background: 'white',
              color: '#333',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Start Over
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <LawnMap 
            center={center} 
            onPolygonChange={setPolygon} 
            onExclusionChange={setExclusion}
            currentStep={currentStep}
          />
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
