//@flow

import type { Account } from 'sf4yt-storage/model/Account'
import AccountState from 'sf4yt-storage/model/AccountState'
import type { Playlist } from 'sf4yt-storage/model/Playlist'
import type { StorageDataSource } from 'sf4yt-storage/StorageDataSource'
import type { Subscription } from 'sf4yt-storage/model/Subscription'
import SubscriptionState from 'sf4yt-storage/model/SubscriptionState'
import SubscriptionType from 'sf4yt-storage/model/SubscriptionType'
import type { Video } from 'sf4yt-storage/model/Video'
import YouTubeApiClient from 'sf4yt-gapi-client/es2015/YouTubeApiClient'

export default class StorageDataSourceImpl {
  _apiClient: YouTubeApiClient

  constructor(apiClient: YouTubeApiClient) {
    this._apiClient = apiClient

    Object.freeze(this)
  }

  async resolveCurrentAccount(): Promise<Account> {
    let currentAccountId = await new Promise((resolve, reject) => {
      window.chrome.identity.getProfileUserInfo(({ id }) => {
        if (window.chrome.runtime.lastError) {
          reject(new Error(window.chrome.runtime.lastError.message))
        } else {
          resolve(id)
        }
      })
    })

    if (!currentAccountId) {
      throw new Error('There is no user currently signed into the browser')
    }

    return await this.resolveAccount(currentAccountId)
  }

  async resolveAccount(accountId: string): Promise<Account> {
    let currentId = await new Promise((resolve, reject) => {
      window.chrome.identity.getProfileUserInfo(({ id }) => {
        if (window.chrome.runtime.lastError) {
          reject(new Error(window.chrome.runtime.lastError.message))
        } else {
          resolve(id)
        }
      })
    })
    if (currentId !== accountId) {
      throw new Error(
        `The user\' currently selected account (ID ${currentId}) is not the ` +
        `specified one (ID ${accountId})`
      )
    }

    let accountInfo = await this._apiClient.getAccountInfo()
    let accountChannel = await this._apiClient.getChannelInfo(accountInfo.id)

    let playlists = await this._apiClient.getPlaylists([
        accountChannel.uploadsPlaylistId,
        accountInfo.playlistIds.watchHistory,
        accountInfo.playlistIds.watchLater
    ])

    return {
      id: accountId,
      channel: {
        id: accountChannel.id,
        title: accountChannel.title,
        thumbnails: accountChannel.thumbnails,
        uploadsPlaylist: playlists[0]
      },
      title: accountInfo.title,
      state: AccountState.ACTIVE,
      lastError: undefined,
      watchHistoryPlaylist: playlists[1],
      watchLaterPlaylist: playlists[2]
    }
  }

  async fetchSubscriptions(account: Account): Promise<Array<Subscription>> {
    let subscriptions = await this._apiClient.getSubscribedChannels(
      account.channel.id
    )

    let uploadsPlaylistIds = await this._apiClient.getUploadsPlaylistIds(
        subscriptions.map(subscribedChannel => subscribedChannel.id)
    )
    let uploadsPlaylists = await this._apiClient.getPlaylists(
        uploadsPlaylistIds.map(playlistInfo => playlistInfo.uploadsPlaylistId)
    )
    let playlistsMap = new Map()
    for (let playlist of uploadsPlaylists) {
      playlistsMap.set(playlist.channelId, {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        videoCount: playlist.videoCount,
        thumbnails: playlist.thumbnails
      })
    }

    return subscriptions.map(subscribedChannel => ({
      type: SubscriptionType.CHANNEL,
      playlist: playlistsMap.get(subscribedChannel.id),
      channel: {
        id: subscribedChannel.id,
        title: subscribedChannel.title,
        thumbnails: subscribedChannel.thumbnails,
        uploadsPlaylist: playlistsMap.get(subscribedChannel.id)
      },
      state: SubscriptionState.ACTIVE,
      lastError: undefined,
      account: account,
      isIncognito: false
    }))
  }

  async resolveIncognitoChannelSubscription(
    channelId: string
  ): Promise<Subscription> {
    let channel = await this._apiClient.getChannelInfo(channelId)
    let uploadsPlaylistData = await this._apiClient.getPlaylistInfo(
      channel.uploadsPlaylistId
    )
    let uploadsPlaylist = {
      id: uploadsPlaylistData.id,
      title: uploadsPlaylistData.title,
      description: uploadsPlaylistData.description,
      videoCount: uploadsPlaylistData.videoCount,
      thumbnails: uploadsPlaylistData.thumbnails
    }

    return {
      type: SubscriptionType.CHANNEL,
      playlist: uploadsPlaylist,
      channel: {
        id: channel.id,
        title: channel.title,
        thumbnails: channel.thumbnails,
        uploadsPlaylist
      },
      state: SubscriptionState.ACTIVE,
      lastError: undefined,
      account: undefined,
      isIncognito: true
    }
  }

  async resolveIncognitoPlaylistSubscription(
    playlistId: string
  ): Promise<Subscription> {
    let playlistData = await this._apiClient.getPlaylistInfo(playlistId)
    let channelData = await this._apiClient.getChannelInfo(
      playlistData.channelId
    )

    let playlist = {
      id: playlistData.id,
      title: playlistData.title,
      description: playlistData.description,
      videoCount: playlistData.videoCount,
      thumbnails: playlistData.thumbnails
    }

    let uploadsPlaylist
    if (channelData.uploadsPlaylistId === playlistId) {
      uploadsPlaylist = playlist
    } else {
      let uploadsPlaylistData = await this._apiClient.getPlaylistInfo(
        channelData.uploadsPlaylistId
      )
      uploadsPlaylist = {
        id: uploadsPlaylistData.id,
        title: uploadsPlaylistData.title,
        description: uploadsPlaylistData.description,
        videoCount: uploadsPlaylistData.videoCount,
        thumbnails: uploadsPlaylistData.thumbnails
      }
    }

    return {
      type: SubscriptionType.PLAYLIST,
      playlist,
      channel: {
        id: channelData.id,
        title: channelData.title,
        thumbnails: channelData.thumbnails,
        uploadsPlaylist
      },
      state: SubscriptionState.ACTIVE,
      lastError: undefined,
      account: undefined,
      isIncognito: true
    }
  }

  async fetchPlaylistUpdates(
    playlists: Array<Playlist>
  ): Promise<Array<Playlist>> {
    let fetchedPlaylists = await this._apiClient.getPlaylists(
      playlists.map(playlist => playlist.id)
    )

    let playlistMap = new Map(playlists.map(
        playlist => [playlist.id, playlist]
    ))
    let updatedPlaylists = []

    for (let playlist of fetchedPlaylists) {
      let sourcePlaylist: ?Playlist = playlistMap.get(playlist.id)
      if (!sourcePlaylist) {
        // this will (should) never happen, but flow complains otherwise
        continue
      }

      let thumbnails = playlist.thumbnails
      let sourceThumbnails = sourcePlaylist.thumbnails
      if (
        playlist.title !== sourcePlaylist.title ||
        playlist.description !== sourcePlaylist.description ||
        JSON.stringify(thumbnails) !== JSON.stringify(sourceThumbnails) ||
        playlist.videoCount !== sourcePlaylist.videoCount
      ) {
        sourcePlaylist.title = playlist.title
        sourcePlaylist.description = playlist.description
        sourcePlaylist.thumbnails = playlist.thumbnails
        sourcePlaylist.videoCount = playlist.videoCount
        updatedPlaylists.push(sourcePlaylist)
      }
    }

    return updatedPlaylists
  }

  async fetchVideos(
    playlist: Playlist,
    shouldContinue: (videos: Array<Video>) => boolean
  ): Promise<Array<Video>> {
    let raw = await this._apiClient.getPlaylistVideos(playlist.id, batch => {
      return shouldContinue(batch.map(createVideo))
    })

    let videos = raw.map(createVideo)
    let channelsMap = new Map(videos.map(video => [video.channel.id, null]))
    for (let channelId of channelsMap.keys()) {
      let channel = await this._apiClient.getChannelInfo(channelId)
      let uploadsPlaylist
      if (channel.uploadsPlaylistId === playlist.id) {
        uploadsPlaylist = playlist
      } else {
        uploadsPlaylist = await this._apiClient.getPlaylistInfo(
          channel.uploadsPlaylistId
        )
      }
      channelsMap.set(channelId, {
        id: channel.id,
        title: channel.title,
        thumbnails: channel.thumbnails,
        uploadsPlaylist: {
          id: playlist.id,
          title: playlist.title,
          description: playlist.description,
          videoCount: playlist.videoCount,
          thumbnails: playlist.thumbnails
        }
      })
    }
    for (let video of videos) {
      video.channel = channelsMap.get(video.channel.id)
    }

    return videos

    function createVideo(fetchedVideo): Video {
      let emptyThumbnails: {[label: string]: string} = {}

      return {
        id: fetchedVideo.id,
        title: fetchedVideo.title,
        description: fetchedVideo.description,
        publishedAt: fetchedVideo.publishedAt,
        thumbnails: fetchedVideo.thumbnails,
        duration: -1,
        viewCount: -1,
        channel: {
          id: fetchedVideo.channelId,
          title: '',
          thumbnails: emptyThumbnails,
          uploadsPlaylist: playlist
        },
        watched: false,
        lastUpdate: new Date()
      }
    }
  }

  async fetchViewCountUpdates(videos: Array<Video>): Promise<Array<Video>> {
    let videosMap = new Map(videos.map(video => [video.id, video]))
    let videosIds = Array.from(videosMap.keys())

    let updatedVideos = []
    let stats = await this._apiClient.getVideosMetaData(videosIds)
    for (let videoStat of stats) {
      let video = videosMap.get(videoStat.id)
      if (
        !video ||
        video.viewCount === videoStat.viewCount ||
        video.duration === videoStat.duration
      ) {
        continue
      }

      video.viewCount = videoStat.viewCount
      video.duration = videoStat.duration
      updatedVideos.push(video)
    }

    return updatedVideos
  }
}

let implementsCheck: Class<StorageDataSource> = StorageDataSourceImpl
