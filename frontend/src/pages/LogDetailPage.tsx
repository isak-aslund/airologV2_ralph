import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getLog, downloadLog, uploadToFlightReview, updateLog } from '../api/logs'
import { getPilots, getDroneModels } from '../api/pilots'
import { formatDateISO } from '../utils/date'
import WeatherSection from '../components/WeatherSection'
import AttachmentsSection from '../components/AttachmentsSection'
import ParameterModal from '../components/ParameterModal'
import InlineEdit from '../components/InlineEdit'
import TagInput from '../components/TagInput'
import type { FlightLog, DroneModel } from '../types'

// leaflet marker icon fix (same as MapModal)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const KNOWN_DRONE_MODELS: DroneModel[] = ['4006', '4010', '4030']

const AUTOSTART_TO_MODEL: Record<string, string> = {
  '4006': 'XLT',
  '4010': 'S1',
  '4030': 'CX10',
}

const TAG_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-yellow-100 text-yellow-800',
  'bg-pink-100 text-pink-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
]

function getTagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length]
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '--:--:--'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatCoord(coord: number, isLat: boolean) {
  const direction = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W')
  return `${Math.abs(coord).toFixed(6)}\u00B0 ${direction}`
}

function MapResizeHandler() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 100)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

function DetailSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl animate-pulse">
      <div className="h-5 w-32 bg-gray-200 rounded mb-6" />
      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-gray-200 rounded" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-gray-200 rounded" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-20 bg-gray-200 rounded" />
              <div className="h-5 w-36 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="h-64 bg-gray-200 rounded" />
      </div>
    </div>
  )
}

export default function LogDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [log, setLog] = useState<FlightLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showParameters, setShowParameters] = useState(false)
  const [uploadingFlightReview, setUploadingFlightReview] = useState(false)
  const [pilots, setPilots] = useState<string[]>([])
  const [droneModels, setDroneModels] = useState<string[]>([])
  const [editingTags, setEditingTags] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    getLog(id)
      .then(setLog)
      .catch((err) => {
        if (err.response?.status === 404) {
          setError('Flight log not found.')
        } else {
          setError('Failed to load flight log.')
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    getPilots().then(setPilots).catch(() => {})
    getDroneModels().then(setDroneModels).catch(() => {})
  }, [])

  const refreshLog = () => {
    if (!id) return
    getLog(id).then(setLog).catch(() => {})
  }

  const saveField = async (field: string, value: unknown) => {
    if (!log) return
    await updateLog(log.id, { [field]: value })
    refreshLog()
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = window.location.href
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = async () => {
    if (!log) return
    try {
      const blob = await downloadLog(log.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${log.title.replace(/[^a-zA-Z0-9]/g, '_')}.ulg`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Error downloading log:', err)
      alert('Failed to download log file')
    }
  }

  const handleOpenFlightReview = async () => {
    if (!log) return
    if (log.flight_review_id) {
      window.open(`http://10.0.0.100:5006/plot_app?log=${log.flight_review_id}`, '_blank')
      return
    }
    try {
      setUploadingFlightReview(true)
      const result = await uploadToFlightReview(log.id)
      window.open(result.url, '_blank')
      setLog((prev) => prev ? { ...prev, flight_review_id: result.flight_review_id } : prev)
    } catch (err) {
      console.error('Error uploading to Flight Review:', err)
      alert('Failed to upload to Flight Review. Please try again.')
    } finally {
      setUploadingFlightReview(false)
    }
  }

  if (loading) {
    return <DetailSkeleton />
  }

  if (error || !log) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium inline-flex items-center gap-1 mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to logs
        </Link>
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          <p className="text-gray-500 text-lg">{error || 'Flight log not found.'}</p>
          <Link to="/" className="mt-4 inline-block text-blue-600 hover:text-blue-800 font-medium">
            Return to flight logs
          </Link>
        </div>
      </div>
    )
  }

  const hasGps = log.takeoff_lat !== null && log.takeoff_lon !== null
  const hasWeather = hasGps && log.flight_date !== null
  const modelName = AUTOSTART_TO_MODEL[log.drone_model]
  const isKnownModel = KNOWN_DRONE_MODELS.includes(log.drone_model as DroneModel)

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to logs
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Copy link
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {/* Header: drone thumbnail + title */}
        <div className="px-6 py-5 border-b border-gray-200">
          <div className="flex items-center gap-4">
            {isKnownModel ? (
              <img
                src={`/img/${modelName}.png`}
                alt={`${modelName} drone`}
                className="w-16 h-16 object-contain"
              />
            ) : (
              <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </div>
            )}
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                <InlineEdit
                  value={log.title}
                  onSave={(v) => saveField('title', v)}
                />
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {modelName || log.drone_model}
                {log.serial_number && <span> &middot; S/N {log.serial_number}</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="px-6 py-5 border-b border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pilot</dt>
              <dd className="mt-1">
                <InlineEdit
                  value={log.pilot}
                  onSave={(v) => saveField('pilot', v)}
                  type="select"
                  options={[...new Set([log.pilot, ...pilots])].map((p) => ({ value: p, label: p }))}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Flight date</dt>
              <dd className="mt-1">
                <InlineEdit
                  value={log.flight_date ? log.flight_date.slice(0, 10) : ''}
                  displayValue={formatDateISO(log.flight_date)}
                  onSave={(v) => saveField('flight_date', v ? `${v}T00:00:00` : null)}
                  type="date"
                  placeholder="No date"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</dt>
              <dd className="mt-1 text-sm text-gray-900 font-mono">{formatDuration(log.duration_seconds)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Takeoff weight</dt>
              <dd className="mt-1">
                <InlineEdit
                  value={log.tow !== null ? String(log.tow) : ''}
                  displayValue={log.tow !== null ? log.tow.toFixed(2) : undefined}
                  onSave={(v) => saveField('tow', v ? parseFloat(v) : null)}
                  type="number"
                  step="0.01"
                  suffix="kg"
                  placeholder="--"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Drone model</dt>
              <dd className="mt-1">
                <InlineEdit
                  value={log.drone_model}
                  displayValue={modelName || log.drone_model}
                  onSave={(v) => saveField('drone_model', v)}
                  type="select"
                  options={[...new Set([log.drone_model, ...droneModels])].map((m) => ({
                    value: m,
                    label: AUTOSTART_TO_MODEL[m] || m,
                  }))}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Serial number</dt>
              <dd className="mt-1 text-sm text-gray-900">{log.serial_number || '--'}</dd>
            </div>
          </div>
        </div>

        {/* Tags & Modes */}
        <div className="px-6 py-5 border-b border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Tags</dt>
              <dd>
                {editingTags ? (
                  <div>
                    <TagInput
                      selectedTags={log.tags.map((t) => t.name)}
                      onTagsChange={async (newTags) => {
                        await saveField('tags', newTags)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setEditingTags(false)}
                      className="mt-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingTags(true)}
                    className="group flex flex-wrap items-center gap-1.5"
                  >
                    {log.tags.length === 0 ? (
                      <span className="text-sm text-gray-400 italic">No tags</span>
                    ) : (
                      log.tags.map((tag, i) => (
                        <span
                          key={tag.id}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${getTagColor(i)}`}
                        >
                          {tag.name}
                        </span>
                      ))
                    )}
                    <svg
                      className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Flight modes</dt>
              <dd className="flex flex-wrap gap-1.5">
                {!log.flight_modes || log.flight_modes.length === 0 ? (
                  <span className="text-sm text-gray-400">No modes</span>
                ) : (
                  log.flight_modes.map((mode, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800"
                    >
                      {mode}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </div>
        </div>

        {/* Comment */}
        <div className="px-6 py-5 border-b border-gray-200">
          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Comment</dt>
          <dd>
            <InlineEdit
              value={log.comment || ''}
              onSave={(v) => saveField('comment', v || null)}
              type="textarea"
              placeholder="Add a comment..."
            />
          </dd>
        </div>

        {/* Map */}
        {hasGps && (
          <div className="px-6 py-5 border-b border-gray-200">
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Takeoff location</dt>
            <dd>
              <div className="h-72 rounded-lg overflow-hidden border border-gray-200">
                <MapContainer
                  center={[log.takeoff_lat!, log.takeoff_lon!]}
                  zoom={15}
                  className="h-full w-full"
                >
                  <MapResizeHandler />
                  <TileLayer
                    attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                  <Marker position={[log.takeoff_lat!, log.takeoff_lon!]}>
                    <Popup>
                      <div className="text-sm">
                        <div className="font-medium">{log.title}</div>
                        <div className="text-gray-600 mt-1">
                          {formatCoord(log.takeoff_lat!, true)}<br />
                          {formatCoord(log.takeoff_lon!, false)}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm text-gray-500 font-mono">
                  {formatCoord(log.takeoff_lat!, true)}, {formatCoord(log.takeoff_lon!, false)}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${log.takeoff_lat},${log.takeoff_lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Open in Google Maps
                </a>
              </div>
            </dd>
          </div>
        )}

        {/* Weather */}
        {hasWeather && (
          <div className="px-6 py-5 border-b border-gray-200">
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Historical weather</dt>
            <dd>
              <WeatherSection
                lat={log.takeoff_lat!}
                lon={log.takeoff_lon!}
                date={log.flight_date!}
                durationSeconds={log.duration_seconds}
              />
            </dd>
          </div>
        )}

        {/* Attachments */}
        <AttachmentsSection
          logId={log.id}
          attachments={log.attachments}
          onChanged={refreshLog}
        />

        {/* Actions bar */}
        <div className="px-6 py-4 border-b border-gray-200">
          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Actions</dt>
          <dd className="flex flex-wrap gap-2">
            {/* Download */}
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download ULog
            </button>

            {/* Flight Review */}
            <button
              onClick={handleOpenFlightReview}
              disabled={uploadingFlightReview}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
            >
              {uploadingFlightReview ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
              {uploadingFlightReview
                ? 'Uploading...'
                : log.flight_review_id
                  ? 'Open Flight Review'
                  : 'Upload & Open Flight Review'}
            </button>

            {/* View Parameters */}
            <button
              onClick={() => setShowParameters(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              View Parameters
            </button>

          </dd>
        </div>

        {/* Timestamps footer */}
        <div className="px-6 py-4 bg-gray-50 text-xs text-gray-400">
          Created {formatDateISO(log.created_at)} &middot; Updated {formatDateISO(log.updated_at)}
        </div>
      </div>

      {/* Parameter Modal */}
      {showParameters && (
        <ParameterModal
          logId={log.id}
          logTitle={log.title}
          onClose={() => setShowParameters(false)}
        />
      )}
    </div>
  )
}
