import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatDateISO } from '../utils/date'
// leaflet CSS is imported globally in index.css

// Fix for default marker icons in React-Leaflet
// https://github.com/PaulLeCam/react-leaflet/issues/453
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

// Component to fix map size when rendered in a modal
function MapResizeHandler() {
  const map = useMap()
  useEffect(() => {
    // Invalidate size after a short delay to ensure container is fully rendered
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 100)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

interface MapModalProps {
  lat: number
  lon: number
  logTitle: string
  flightDate?: string | null
  onClose: () => void
}

export default function MapModal({ lat, lon, logTitle, flightDate, onClose }: MapModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Format coordinates for display
  const formatCoord = (coord: number, isLat: boolean) => {
    const direction = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W')
    return `${Math.abs(coord).toFixed(6)}° ${direction}`
  }

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Flight Location
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {logTitle}
                {flightDate && ` - ${formatDateISO(flightDate)}`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Map */}
          <div className="h-[500px] w-full">
            <MapContainer
              center={[lat, lon]}
              zoom={15}
              className="h-full w-full"
            >
              <MapResizeHandler />
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <Marker position={[lat, lon]}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-medium">{logTitle}</div>
                    <div className="text-gray-600 mt-1">
                      {formatCoord(lat, true)}<br />
                      {formatCoord(lon, false)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>

          {/* Footer with coordinates */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <div className="text-sm text-gray-600 font-mono">
              {formatCoord(lat, true)}, {formatCoord(lon, false)}
            </div>
            <div className="flex gap-2">
              <a
                href={`https://www.google.com/maps?q=${lat},${lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
              >
                Open in Google Maps
              </a>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
