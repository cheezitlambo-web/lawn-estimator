import { NextRequest, NextResponse } from 'next/server'

// Proxy to Overpass to fetch OSM building polygons within bbox
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const bbox = searchParams.get('bbox') // south,west,north,east
  if (!bbox) {
    return NextResponse.json({ error: 'bbox required' }, { status: 400 })
  }

  const query = `[out:json][timeout:25];(way["building"](${bbox});relation["building"](${bbox}););out body;>;out skel qt;`

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query })
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json(data)
      }
    } catch {}
  }

  // Fallback: return empty Overpass-like structure so client can proceed
  return NextResponse.json({ elements: [] }, { status: 200 })
}
