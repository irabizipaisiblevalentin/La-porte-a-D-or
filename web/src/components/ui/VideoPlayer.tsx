import { useState } from "react"
import { Play, Youtube } from "lucide-react"
import { Modal } from "./Modal"

/**
 * Where a video is played from. Always the official YouTube embed: choir media
 * is never downloaded, re-hosted or proxied, so nothing here may point anywhere
 * else.
 */
export function embedUrl(youtubeVideoId: string): string {
  return `https://www.youtube.com/embed/${youtubeVideoId}`
}

export interface VideoPlayerModalProps {
  open: boolean
  onClose: () => void
  /** 11-character YouTube id. */
  videoId: string
  title: string
  description?: string | null
  /** Shown under the player — channel, date, anything already known. */
  meta?: string | null
  /** The original link, offered as the way out to YouTube itself. */
  url?: string | null
  footer?: React.ReactNode
}

/**
 * Plays one video in a dialog, on the site, without sending the member away to
 * youtube.com. Playback starts the moment it opens — the click that opened the
 * dialog is the gesture the browser needs — and open + title travel in the URL
 * (`?watch=…`) so the back button closes the player and a link can be shared.
 */
export function VideoPlayerModal({
  open,
  onClose,
  videoId,
  title,
  description,
  meta,
  url,
  footer,
}: VideoPlayerModalProps) {
  const youtubeUrl = url ?? `https://www.youtube.com/watch?v=${videoId}`
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? undefined}
      size="lg"
      footer={
        <>
          {footer}
          <a href={youtubeUrl} target="_blank" rel="noreferrer noopener" className="btn btn-outline">
            <Youtube size={16} /> Watch on YouTube
          </a>
        </>
      }
    >
      <div className="overflow-hidden rounded-xl border hairline bg-black">
        <iframe
          // The key restarts playback when a different video is opened in the
          // same dialog; without it the player would keep the previous video.
          key={videoId}
          src={`${embedUrl(videoId)}?autoplay=1&rel=0`}
          title={title}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {meta ? <p className="muted mt-3 text-xs">{meta}</p> : null}
    </Modal>
  )
}

export interface VideoThumbnailProps {
  /** 11-character YouTube id; null when only a stored still image exists. */
  videoId: string | null
  title: string
  thumbnailUrl: string | null
  /** Adds the play badge and the hover treatment. */
  playable?: boolean
  className?: string
}

/**
 * Cover art for a video. Clicking it is the member's "start watching": when a
 * player id is known the parent opens `VideoPlayerModal`, otherwise the still is
 * shown on its own rather than pretending it can play.
 *
 * A stored thumbnail that YouTube refuses to load falls back to the video's own
 * cover image, so the tile is never blank.
 */
export function VideoThumbnail({ videoId, title, thumbnailUrl, playable = true, className = "" }: VideoThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const fallback = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null
  const source = !failed && thumbnailUrl ? thumbnailUrl : fallback
  const canPlay = playable && Boolean(videoId)

  return (
    <div className={`relative aspect-video w-full overflow-hidden bg-black/40 ${className}`}>
      {source ? (
        <img
          src={source}
          alt=""
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition duration-200 ${canPlay ? "group-hover:scale-[1.03]" : ""}`}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Youtube size={24} className="opacity-40" />
        </span>
      )}
      {canPlay ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition duration-200 group-hover:bg-black/40">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-charcoal-950 shadow-lg">
            <Play size={18} className="ml-0.5" fill="currentColor" />
          </span>
        </span>
      ) : null}
    </div>
  )
}
