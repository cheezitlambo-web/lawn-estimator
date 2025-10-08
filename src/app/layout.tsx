import type { Metadata } from 'next'
import './globals.css'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

export const metadata: Metadata = {
  title: 'Lawn Estimator',
  description: 'Estimate lawn square footage by drawing on a map',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          src="https://maps.googleapis.com/maps/api/js?key=AIzaSyAE-X6GtQP24JXFgdHlqAkPon6mqiTw7TM&libraries=places"
          async
          defer
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
