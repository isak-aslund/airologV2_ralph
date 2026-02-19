import { useState, useRef, useCallback } from 'react'
import { uploadAttachments, deleteAttachment, getAttachmentUrl } from '../api/logs'
import type { Attachment } from '../types'

interface AttachmentsSectionProps {
  logId: string
  attachments: Attachment[]
  onChanged: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(contentType: string): boolean {
  return contentType.startsWith('image/')
}

function isVideo(contentType: string): boolean {
  return contentType.startsWith('video/')
}

function getFileIcon(contentType: string): string {
  if (contentType.startsWith('application/pdf')) return 'PDF'
  if (contentType.startsWith('text/')) return 'TXT'
  if (contentType.includes('spreadsheet') || contentType.includes('excel')) return 'XLS'
  if (contentType.includes('document') || contentType.includes('word')) return 'DOC'
  return 'FILE'
}

export default function AttachmentsSection({ logId, attachments, onChanged }: AttachmentsSectionProps) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Media attachments for lightbox navigation (images + videos)
  const mediaAttachments = attachments.filter(
    (a) => isImage(a.content_type) || isVideo(a.content_type)
  )

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setUploading(true)
    try {
      await uploadAttachments(logId, fileArray)
      onChanged()
    } catch (err) {
      console.error('Upload failed:', err)
      alert('Failed to upload attachments')
    } finally {
      setUploading(false)
    }
  }, [logId, onChanged])

  const handleDelete = async (attachmentId: string) => {
    try {
      await deleteAttachment(logId, attachmentId)
      setDeleteConfirm(null)
      if (lightboxIndex !== null) setLightboxIndex(null)
      onChanged()
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Failed to delete attachment')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files)
    }
  }, [handleUpload])

  const openLightbox = (attachment: Attachment) => {
    const idx = mediaAttachments.findIndex((a) => a.id === attachment.id)
    if (idx !== -1) setLightboxIndex(idx)
  }

  const lightboxPrev = () => {
    if (lightboxIndex === null) return
    setLightboxIndex(lightboxIndex === 0 ? mediaAttachments.length - 1 : lightboxIndex - 1)
  }

  const lightboxNext = () => {
    if (lightboxIndex === null) return
    setLightboxIndex(lightboxIndex === mediaAttachments.length - 1 ? 0 : lightboxIndex + 1)
  }

  const currentLightboxItem = lightboxIndex !== null ? mediaAttachments[lightboxIndex] : null

  return (
    <div className="px-6 py-5 border-b border-gray-200">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
        Attachments
        {attachments.length > 0 && (
          <span className="ml-1.5 text-gray-400">({attachments.length})</span>
        )}
      </dt>
      <dd>
        {/* Upload area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleUpload(e.target.files)
              e.target.value = ''
            }}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading...
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              <svg className="mx-auto w-8 h-8 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16v-8m0 0l-3 3m3-3l3 3M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
              </svg>
              <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
              <p className="text-xs text-gray-400 mt-0.5">Images, videos, documents, or any file</p>
            </div>
          )}
        </div>

        {/* Gallery grid */}
        {attachments.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-4">
            {attachments.map((att) => {
              const url = getAttachmentUrl(logId, att.id)
              return (
                <div
                  key={att.id}
                  className="group relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
                >
                  {/* Thumbnail / icon */}
                  {isImage(att.content_type) ? (
                    <div
                      className="aspect-square cursor-pointer"
                      onClick={() => openLightbox(att)}
                    >
                      <img
                        src={url}
                        alt={att.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : isVideo(att.content_type) ? (
                    <div
                      className="aspect-square cursor-pointer relative bg-black"
                      onClick={() => openLightbox(att)}
                    >
                      <video
                        src={url}
                        className="w-full h-full object-cover"
                        preload="metadata"
                      />
                      {/* Play icon overlay */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 bg-black/60 rounded-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <a
                      href={url}
                      download={att.filename}
                      className="aspect-square flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-600"
                    >
                      <span className="text-lg font-bold">{getFileIcon(att.content_type)}</span>
                      <span className="text-[10px] text-gray-500 px-2 truncate max-w-full">
                        {att.filename}
                      </span>
                    </a>
                  )}

                  {/* Info overlay at bottom */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-[10px] truncate">{att.filename}</p>
                    <p className="text-white/70 text-[10px]">{formatFileSize(att.file_size)}</p>
                  </div>

                  {/* Action buttons */}
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={url}
                      download={att.filename}
                      className="p-1 bg-white/90 rounded shadow text-gray-600 hover:text-blue-600"
                      title="Download"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(att.id) }}
                      className="p-1 bg-white/90 rounded shadow text-gray-600 hover:text-red-600"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </dd>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Delete attachment?</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will permanently delete the file. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {currentLightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxIndex(null)}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Prev/Next */}
          {mediaAttachments.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10 p-2"
                onClick={(e) => { e.stopPropagation(); lightboxPrev() }}
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10 p-2"
                onClick={(e) => { e.stopPropagation(); lightboxNext() }}
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Content */}
          <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {isImage(currentLightboxItem.content_type) ? (
              <img
                src={getAttachmentUrl(logId, currentLightboxItem.id)}
                alt={currentLightboxItem.filename}
                className="max-w-full max-h-[85vh] object-contain"
              />
            ) : (
              <video
                src={getAttachmentUrl(logId, currentLightboxItem.id)}
                controls
                autoPlay
                className="max-w-full max-h-[85vh]"
              />
            )}
          </div>

          {/* Bottom info bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm text-center">
            <p>{currentLightboxItem.filename}</p>
            <p className="text-white/50 text-xs mt-0.5">
              {formatFileSize(currentLightboxItem.file_size)}
              {mediaAttachments.length > 1 && ` \u2022 ${lightboxIndex! + 1} / ${mediaAttachments.length}`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
