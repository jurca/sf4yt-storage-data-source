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

    return subscriptions.map(subscribedChannel => ({
      id: undefined,
      type: SubscriptionType.CHANNEL,
      playlist: {}, // TODO
      channel: {}, // TODO
      state: SubscriptionState.ACTIVE,
      lastError: undefined,
      account: account,
      isIncognito: false
    }))
  }

  async fetchPlaylistUpdates(
    playlists: Array<Playlist>
  ): Promise<Array<Playlist>> {}

  async fetchVideos(
      playlist: Playlist,
      shouldContinue: (videos: Array<Video>) => boolean
  ): Promise<Array<Video>> {}

  async fetchViewCountUpdates(videos: Array<Video>): Promise<Array<Video>> {}
}

let implementsCheck: Class<StorageDataSource> = StorageDataSourceImpl
