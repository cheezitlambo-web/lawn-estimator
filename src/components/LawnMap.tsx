'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import * as turf from '@turf/turf'

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false })
const FeatureGroup = dynamic(() => import('react-leaflet').then(m => m.FeatureGroup), { ssr: false })
const EditControl = dynamic(() => import('react-leaflet-draw').then(m => m.EditControl), { ssr: false })

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

export type LawnMapProps = {
  center: [number, number]
  onPolygonChange: (polygon: GeoJSON.Feature<GeoJSON.Polygon> | null) => void
  onExclusionChange?: (polygon: GeoJSON.Feature<GeoJSON.Polygon> | null) => void
}

export default function LawnMap({ center, onPolygonChange, onExclusionChange }: LawnMapProps) {
  const [polygon, setPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null)
  const [exclusion, setExclusion] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup>(null)
  const exclusionGroupRef = useRef<L.FeatureGroup>(null)
  const mapRef = useRef<L.Map>(null)

  // Removed unused drawOptions

  useEffect(() => {
    onPolygonChange(polygon)
  }, [polygon, onPolygonChange])

  useEffect(() => {
    onExclusionChange?.(exclusion)
  }, [exclusion, onExclusionChange])

  useEffect(() => {
    const map = mapRef.current
    if (map && center) {
      try {
        const targetZoom = Math.min(Math.max(map.getZoom?.() ?? 18, 18), 19)
        console.log('Map recenter to', center, 'zoom', targetZoom)
        map.flyTo(center, targetZoom, { animate: true, duration: 0.75 })
      } catch (e) {
        console.warn('Map recenter failed', e)
      }
    }
  }, [center])

  return (
    <MapContainer ref={mapRef} center={center} zoom={10} minZoom={3} maxZoom={22} style={{ height: 500, width: '100%', borderRadius: 8 }} scrollWheelZoom>
      <TileLayer 
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
        maxNativeZoom={19}
        maxZoom={22}
      />
      <FeatureGroup ref={featureGroupRef} pathOptions={{ color: '#2a7' }}>
        <EditControl
          position="topleft"
          draw={{
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false,
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#2a7', fillColor: '#bfe8cf' } }
          }}
          edit={{ remove: true }}
          onCreated={(e: L.DrawEvents.Created) => {
            const layer = e.layer
            const latlngs = layer.getLatLngs()[0].map((ll: L.LatLng) => [ll.lng, ll.lat])
            const closed = latlngs[0][0] === latlngs[latlngs.length-1][0] && latlngs[0][1] === latlngs[latlngs.length-1][1] ? latlngs : [...latlngs, latlngs[0]]
            const poly = turf.polygon([closed])
            setPolygon(poly)
          }}
          onEdited={() => {
            const layers = featureGroupRef.current?.getLayers?.() || []
            if (layers.length === 0) { setPolygon(null); return }
            const layer = layers[0]
            const latlngs = layer.getLatLngs()[0].map((ll: L.LatLng) => [ll.lng, ll.lat])
            const closed = latlngs[0][0] === latlngs[latlngs.length-1][0] && latlngs[0][1] === latlngs[latlngs.length-1][1] ? latlngs : [...latlngs, latlngs[0]]
            const poly = turf.polygon([closed])
            setPolygon(poly)
          }}
          onDeleted={() => setPolygon(null)}
        />
      </FeatureGroup>
      {/* Exclusion group (e.g., house) in red - only show if lawn polygon exists */}
      {polygon && (
        <FeatureGroup ref={exclusionGroupRef} pathOptions={{ color: '#d33' }}>
          <EditControl
            position="bottomright"
            draw={{
              rectangle: false,
              circle: false,
              circlemarker: false,
              marker: false,
              polyline: false,
              polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#d33', fillColor: '#f99' } }
            }}
            edit={{ remove: true }}
            onCreated={(e: L.DrawEvents.Created) => {
              const layer = e.layer
              const latlngs = layer.getLatLngs()[0].map((ll: L.LatLng) => [ll.lng, ll.lat])
              const closed = latlngs[0][0] === latlngs[latlngs.length-1][0] && latlngs[0][1] === latlngs[latlngs.length-1][1] ? latlngs : [...latlngs, latlngs[0]]
              const poly = turf.polygon([closed])
              setExclusion(poly)
            }}
            onEdited={() => {
              const layers = exclusionGroupRef.current?.getLayers?.() || []
              if (layers.length === 0) { setExclusion(null); return }
              const layer = layers[0]
              const latlngs = layer.getLatLngs()[0].map((ll: L.LatLng) => [ll.lng, ll.lat])
              const closed = latlngs[0][0] === latlngs[latlngs.length-1][0] && latlngs[0][1] === latlngs[latlngs.length-1][1] ? latlngs : [...latlngs, latlngs[0]]
              const poly = turf.polygon([closed])
              setExclusion(poly)
            }}
            onDeleted={() => setExclusion(null)}
          />
        </FeatureGroup>
      )}
    </MapContainer>
  )
}
