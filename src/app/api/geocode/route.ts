import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')
  if (!q || q.trim().length < 3) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'json')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'us')
  url.searchParams.set('addressdetails', '0')
  const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'en', 'User-Agent': 'lawn-estimator/1.0' }})
  if (!res.ok) {
    return NextResponse.json({ error: 'geocode failed' }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json(data)
}


