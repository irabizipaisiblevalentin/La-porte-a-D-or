import { badRequest } from "../lib/errors.js"

/**
 * Thin, honest wrapper around the YouTube Data API v3.
 *
 * This module only reads public metadata (titles, descriptions, thumbnails and
 * timestamps). It never downloads media and never invents data: if the API key
 * is missing it throws a clear "not configured" error, and if the upstream call
 * fails it surfaces the real failure rather than a fabricated result.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3"

export interface ChannelCandidate {
  id: string
  title: string
  description: string
  customUrl: string | null
  thumbnail: string | null
}

export interface VideoMetadata {
  id: string
  title: string
  description: string
  url: string
  thumbnailUrl: string | null
  publishedAt: string | null
  channelId: string | null
  channelTitle: string | null
}

export interface ChannelUploads {
  videos: VideoMetadata[]
  nextPageToken: string | null
}

/** Raised for a failed (non-2xx) or unreachable YouTube Data API request. */
export class YouTubeApiError extends Error {
  status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = "YouTubeApiError"
    this.status = status
  }
}

interface Thumbnail {
  url?: string
}

interface Thumbnails {
  default?: Thumbnail
  medium?: Thumbnail
  high?: Thumbnail
}

interface ChannelSnippet {
  title?: string
  description?: string
  customUrl?: string
  thumbnails?: Thumbnails
}

interface SearchItem {
  id?: { channelId?: string }
  snippet?: ChannelSnippet
}

interface SearchResponse {
  items?: SearchItem[]
}

interface ChannelListItem {
  id?: string
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
}

interface ChannelListResponse {
  items?: ChannelListItem[]
}

interface PlaylistItem {
  contentDetails?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelId?: string
    channelTitle?: string
    thumbnails?: Thumbnails
  }
}

interface PlaylistItemsResponse {
  items?: PlaylistItem[]
  nextPageToken?: string
}

interface VideoItem {
  id?: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelId?: string
    channelTitle?: string
    thumbnails?: Thumbnails
  }
}

interface VideosResponse {
  items?: VideoItem[]
}

function requireApiKey(apiKey: string): string {
  const key = apiKey.trim()
  if (!key) {
    throw badRequest("The YouTube Data API key is not configured. Add it in Settings before using discovery.")
  }
  return key
}

async function fetchJson<T>(url: URL): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: "application/json" } })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error"
    throw new YouTubeApiError(`Could not reach the YouTube Data API: ${reason}`)
  }
  if (!response.ok) {
    let detail = ""
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? ""
    } catch {
      detail = ""
    }
    const suffix = detail ? `: ${detail}` : ""
    throw new YouTubeApiError(`YouTube Data API request failed (HTTP ${response.status})${suffix}`, response.status)
  }
  return (await response.json()) as T
}

function pickThumbnail(thumbnails: Thumbnails | undefined): string | null {
  return thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

function clampMaxResults(value: number, fallback: number): number {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(50, Math.max(1, resolved))
}

/** Searches public YouTube channels by name. */
export async function searchChannels(apiKey: string, q: string, maxResults = 10): Promise<ChannelCandidate[]> {
  const key = requireApiKey(apiKey)
  const query = q.trim()
  if (!query) throw badRequest("Enter a channel name or search term.")

  const url = new URL(`${API_BASE}/search`)
  url.searchParams.set("part", "snippet")
  url.searchParams.set("type", "channel")
  url.searchParams.set("q", query)
  url.searchParams.set("maxResults", String(clampMaxResults(maxResults, 10)))
  url.searchParams.set("key", key)

  const data = await fetchJson<SearchResponse>(url)
  return (data.items ?? [])
    .map((item): ChannelCandidate | null => {
      const id = item.id?.channelId
      if (!id) return null
      const snippet = item.snippet
      return {
        id,
        title: snippet?.title ?? "",
        description: snippet?.description ?? "",
        customUrl: snippet?.customUrl ?? null,
        thumbnail: pickThumbnail(snippet?.thumbnails),
      }
    })
    .filter((candidate): candidate is ChannelCandidate => candidate !== null)
}

/** Lists recent uploads from a channel's uploads playlist. */
export async function listChannelUploads(
  apiKey: string,
  channelId: string,
  maxResults = 25,
  pageToken?: string,
): Promise<ChannelUploads> {
  const key = requireApiKey(apiKey)
  const channel = channelId.trim()
  if (!channel) throw badRequest("A YouTube channel ID is required.")

  const channelUrl = new URL(`${API_BASE}/channels`)
  channelUrl.searchParams.set("part", "contentDetails")
  channelUrl.searchParams.set("id", channel)
  channelUrl.searchParams.set("key", key)
  const channelData = await fetchJson<ChannelListResponse>(channelUrl)
  const uploads = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) throw new YouTubeApiError("The YouTube channel was not found or has no uploads playlist.")

  const url = new URL(`${API_BASE}/playlistItems`)
  url.searchParams.set("part", "snippet,contentDetails")
  url.searchParams.set("playlistId", uploads)
  url.searchParams.set("maxResults", String(clampMaxResults(maxResults, 25)))
  if (pageToken?.trim()) url.searchParams.set("pageToken", pageToken.trim())
  url.searchParams.set("key", key)

  const data = await fetchJson<PlaylistItemsResponse>(url)
  const videos = (data.items ?? [])
    .map((item): VideoMetadata | null => {
      const id = item.contentDetails?.videoId
      if (!id) return null
      const snippet = item.snippet
      return {
        id,
        title: snippet?.title ?? "",
        description: snippet?.description ?? "",
        url: watchUrl(id),
        thumbnailUrl: pickThumbnail(snippet?.thumbnails),
        publishedAt: snippet?.publishedAt ?? null,
        channelId: snippet?.channelId ?? channel,
        channelTitle: snippet?.channelTitle ?? null,
      }
    })
    .filter((video): video is VideoMetadata => video !== null)

  return { videos, nextPageToken: data.nextPageToken ?? null }
}

/** Fetches metadata for one or more video IDs. */
export async function getVideos(apiKey: string, ids: string[]): Promise<VideoMetadata[]> {
  const key = requireApiKey(apiKey)
  const clean = ids.map((value) => value.trim()).filter((value) => value.length > 0)
  if (clean.length === 0) return []

  const url = new URL(`${API_BASE}/videos`)
  url.searchParams.set("part", "snippet")
  url.searchParams.set("id", clean.join(","))
  url.searchParams.set("key", key)

  const data = await fetchJson<VideosResponse>(url)
  return (data.items ?? [])
    .map((item): VideoMetadata | null => {
      const id = item.id
      if (!id) return null
      const snippet = item.snippet
      return {
        id,
        title: snippet?.title ?? "",
        description: snippet?.description ?? "",
        url: watchUrl(id),
        thumbnailUrl: pickThumbnail(snippet?.thumbnails),
        publishedAt: snippet?.publishedAt ?? null,
        channelId: snippet?.channelId ?? null,
        channelTitle: snippet?.channelTitle ?? null,
      }
    })
    .filter((video): video is VideoMetadata => video !== null)
}
