type Thumbnail = {
  thumbnails: {
    url: string;
    width: number;
    height: number;
  }[];
};

type AccessibilityData = {
  accessibilityData: {
    label: string;
  };
};
type Card = {
  cardRender: {
    teaser: {
      simpleCardTeaserRenderer: {
        message: {
          simpleText: string;
        };
        trackingParams: string;
        prominent: boolean;
        logVisibilityUpdates: boolean;
      };
    };
  };
  content: {
    videoInfoCardContentRenderer: {
      videoThumbnail: Thumbnail;
    };
    lengthString: {
      accessibility: AccessibilityData;
      simpleText: string;
    };
    videoTitle: {
      simpleText: string;
    };
    channelName: {
      simpleText: string;
    };
    action: {
      clickTrackingParams: string;
      commandMetadata: {
        webCommandMetadata: {
          url: string;
          webPageType: string;
          rootVe: number;
        };
      };
      watchEndpoint: {
        videoId: string;
        watchEndpointSupportedOnesieConfig: {
          html5PlaybackOnesieConfig: {
            commonConfig: {
              url: string;
            };
          };
        };
      };
    };
    trackingParams: string;
  };
  cueRanges: {
    [p: string]: string;
  }[];
  icon: {
    infoCardIconRenderer: {
      trackingParams: string;
    };
  };
  trackingParams: string;
  cardId: string;
  feature: string;
};

type EndScreenElement = {
  endscreenElementRenderer: {
    aspectRatio: number;
    callToAction: {
      simpleText: string;
    };
    dismiss: {
      simpleText: string;
    };
    endMs: number;
    endpoint: {
      clickTrackingParams: string;
      commandMetadata: {
        webCommandMetadata: {
          url: string;
          webPageType: string;
          rootVe: number;
        };
      };
      watchEndpoint: {
        videoId: string;
        watchEndpointSupportedOnesieConfig: {
          html5PlaybackOnesieConfig: {
            commonConfig: {
              url: string;
            };
          };
        };
      };
      trackingParams: string;
      id: string;
    };
    hovercardButton: {
      subscribeButtonRenderer: SubscribeButton;
    };
    style: string;
    image: Thumbnail;
    videoDuration: {
      accessibility: AccessibilityData;
      simpleText: string;
    };
    left: number;
    width: number;
    top: number;
    startMs: number;
    title: {
      accessibility: AccessibilityData;
      simpleText: string;
    };
  };
};

type MediaItem = {
  itag: number;
  url: string;
  mimeType: string;
  bitrate: number;
  initRange: {
    start: "0";
    end: string;
  };
  indexRange: {
    start: string;
    end: string;
  };
  lastModified: number;
  contentLength: string;
  averageBitrate: number;
  approxDurationMs: string;
};

export type FormatItem = MediaItem & {
  width: number;
  height: number;
  quality: "tiny" | "medium" | "hd720";
  fps: 30;
  qualityLabel: "144p" | "360p" | "480p" | "720p";
  audioQuality: "AUDIO_QUALITY_LOW" | "AUDIO_QUALITY_MEDIUM";
  approximateDurationMs: string;
  projectionType: string;
  audioSampleRate: string;
  audioChannels: number;
};

export type AdaptiveFormatItem = MediaItem & {
  width?: number;
  height?: number;
  quality: "tiny" | "medium" | "large" | "hd720" | "hd1080" | "hd1440" | "hd2160" | "hd4320";
  fps?: 30 | 48 | 50 | 60;
  qualityLabel?: "144p" | "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p" | "4320p";
  averageBitrate: number;
  audioQuality?: "AUDIO_QUALITY_LOW" | "AUDIO_QUALITY_MEDIUM";
  colorInfo?: {
    primaries: string;
    transferCharacteristics: string;
    matrixCoefficients: string;
  };
  signatureCipher?: string;
  projectionType?: string;
  highReplication?: boolean;
  audioSampleRate?: string;
  loudnessDb?: number;
  audioChannels?: number;
};

type ImpressionURL = {
  baseUrl: string;
};
type Ad = {
  adPlacementRenderer: {
    config: {
      adPlacementConfig: {
        adTimeOffset: {
          offsetStartMilliseconds: string;
          offsetEndMilliseconds: string;
        };
        hideCueRangeMarker: boolean;
        kind: "AD_PLACEMENT_KIND_START" | "AD_PLACEMENT_KIND_END" | "AD_PLACEMENT_KIND_MILLISECONDS";
      };
    };
    renderer: {
      clientForecastingAdRenderer?: {
        impressionUrls: ImpressionURL[];
      };
      adBreakServiceRenderer: {
        getAdBreakUrl: string;
        prefetchMilliseconds: string;
      };
    };
  };
};
type Runs = {
  runs: {
    text: string;
  }[];
};
type Button = {
  buttonRenderer: {
    accessibility: {
      label: string;
    };
    isDisabled: boolean;
    size: string;
    style: string;
    text: Runs;
  };
};
type SignalServiceEndpoint = {
  actions: {
    clickTrackingParams: string;
    openPopupAction: {
      popup: {
        confirmDialogRenderer: {
          cancelButton: Button;
          confirmButton: Button;
          dialogMessages: Runs[];
          primaryIsCancel: boolean;
          trackingParams: string;
        };
      };
      popupType: string;
    };
  }[];
  signal: string;
};
type SubscribeButton = {
  subscribeButtonRenderer: {
    buttonText: Runs;
    channelId: string;
    enabled: boolean;
  };
  serviceEndpoints: {
    clickTrackingParams: string;
    commandMetadata: {
      webCommandMetadata: {
        apiUrl: "/youtubei/v1/subscription/subscribe";
        sendPost: true;
      };
    };
    subscribeEndpoint?: {
      channelIds: string[];
      params: string;
    };
    signalServiceEndpoint?: SignalServiceEndpoint;
  }[];
  showPreferences: boolean;
  signInEndpoint: {
    clickTrackingParams: string;
    commandMetadata: {
      url: string;
    };
  };
  subscribeAccessibility: AccessibilityData;
  subscribed: boolean;
  subscribedButtonText: Runs;
  trackingParams: string;
  type: string;
  unsubscribeButtonAccessibility: AccessibilityData;
  unsubscribeButtonText: Runs;
  unsubscribedButtonText: Runs;
};
export type PlayerResponse = {
  adPlacements?: Ad[];
  annotations?: {
    playerAnnotationsExpandedRenderer: {
      allowSwipeDismiss: boolean;
      annotationId: string;
      featuredChannel: {
        channelName: string;
        endTimeMs: string;
      };
      navigationEndpoint: {
        browseEndpoint: {
          browseId: string;
        };
        clickTrackingParams: string;
        commandMetadata: {
          webCommandMetadata: {
            apiUrl: "/youtubei/v1/browse";
            rootVe: string;
            url: string;
            webPageType: string;
          };
        };
      };
      startTimeMs: string;
      subscribeButton: SubscribeButton;
      watermark: Thumbnail;
    };
  }[];
  storyboards?: {
    playerStoryboardSpecRenderer?: {
      spec: string;
    };
    playerLiveStoryboardRenderer?: {
      spec: string;
    };
  };
  frameworkUpdates: {
    mutations: {
      entityKey: string;
      payload: {
        offlineabilityEntity: {
          accessState: string;
          key: string;
        };
      };
      type: string;
    }[];
    timestamp: {
      nanos: number;
      seconds: string;
    };
  };
  playabilityStatus: {
    status: "OK" | "UNPLAYABLE" | "LOGIN_REQUIRED" | "ERROR";
    reason?: "Video unavailable";
    messages?: string[];
    errorScreen?: {
      playerErrorMessageRenderer: {
        icon: {
          iconType: string;
        };
        proceedButton: {
          style: "STYLE_PRIMARY";
          size: "SIZE_DEFAULT";
          isDisabled: boolean;
          text: {
            simpleText: "Watch on YouTube";
          };
          navigationEndpoint: {
            clickTrackingParams: string;
            commandMetadata: {
              webCommandMetadata: {
                url: string;
                webPageType: "WEB_PAGE_TYPE_UNKNOWN";
                rootVe: number;
              };
            };
            urlEndpoint: {
              url: string;
              target: "TARGET_NEW_WINDOW";
            };
          };
          trackingParams: string;
        };
        reason: {
          simpleText: "Video unavailable";
        };
        subreason?: {
          simpleText: string;
        };
        thumbnail: Thumbnail;
      };
      thumbnail?: Thumbnail;
      icon: {
        iconType: "ERROR_OUTLINE";
      };
    };
    playbackTracking?: {
      atrUri: {
        baseUrl: string;
        elapsedMediaTimeSeconds: number;
      };
      googleRemarketingUrl: {
        baseUrl: string;
        elapsedMediaTimeSeconds: number;
      };
      qoeUrl: {
        baseUrl: string;
      };
      videostatsPlaybackUrl: {
        baseUrl: string;
      };
      videostatsScheduledFlushWalltimeSeconds: number[];
      videostatsWatchtimeUrl: {
        baseUrl: string;
      };
      youtubeRemarketingUrl: {
        baseUrl: string;
        elapsedMediaTimeSeconds: number;
      };
    };
    playerAds?: {
      playerLegacyDesktopWatchAdsRenderer: {
        gutParams: {
          tag: string;
        };
        playerAdParams: {
          enabledEngageTypes: string;
          showContentThumbnail: boolean;
        };
        showCompanion: boolean;
        showInstream: boolean;
        useGut: boolean;
      };
    }[];
    playerConfig?: {
      audioConfig: {
        enablePerFormatLoudness: boolean;
        loudnessDb: number;
        perceptualLoudnessDb: number;
      };
      mediaCommonConfig: {
        dynamicReadaheadConfig: {
          maxReadAheadMediaTimeMs: number;
          minReadAheadMediaTimeMs: number;
          readAheadGrowthRateMs: number;
        };
      };
      streamSelectionConfig: {
        maxBitrate: string;
      };
      webPlayerConfig: {
        webPlayerActionsPorting: {
          addToWatchLaterCommand: {
            clickTrackingParams: string;
            commandMetadata: {
              webCommandMetadata: {
                apiUrl: "/youtubei/v1/browse/edit_playlist";
                sendPost: true;
              };
            };
            playlistEditEndpoint: {
              actions: {
                action: string;
                addedVideoId: string;
              }[];
              playlistId: string;
            };
            getSharePanelCommand: {
              clickTrackingParams: string;
              commandMetadata: {
                webCommandMetadata: {
                  apiUrl: "/youtubei/v1/share/get_web_player_share_panel";
                  sendPost: true;
                };
              };
              webPlayerShareEntityServiceEndpoint: {
                serializedShareEntity: string;
              };
            };
            removeFromWatchLaterCommand: {
              clickTrackingParams: string;
              commandMetadata: {
                webCommandMetadata: {
                  apiUrl: "/youtubei/v1/browse/edit_playlist";
                  sendPost: true;
                };
              };
              playlistEditEndpoint: {
                actions: {
                  action: string;
                  removedVideoId: string;
                }[];
                playlistId: string;
              };
              subscribeCommand: {
                clickTrackingParams: string;
                commandMetadata: {
                  apiUrl: "/youtubei/v1/subscription/subscribe";
                  sendPost: true;
                };
              };
              unsubscribeCommand: {
                clickTrackingParams: string;
                commandMetadata: {
                  apiUrl: "/youtubei/v1/subscription/unsubscribe";
                  sendPost: true;
                };
                unsubscribeEndpoint: {
                  channelIds: string[];
                  params: string;
                };
              };
            };
          };
        };
      };
    };
    contextParams: string;
    liveStremability?: {
      liveStreamabilityRenderer: {
        broadcastId: string;
        pollDelayMs: string;
        videoId: string;
      };
    };
  };
  responseContext: {
    mainAppWebResponseContext: {
      datasyncId?: string;
      loggedOut: boolean;
    };
    serviceTrackingParams: [
      {
        service: "GFEEDBACK";
        params: [
          {
            key: "is_viewed_live";
            value: "False" | "True";
          },
          {
            key: "logged_in";
            value: "0" | "1";
          },
          {
            key: "e";
            value: string;
          }
        ];
      },
      {
        service: "CSI";
        params: [
          {
            key: "c";
            value: "WEB";
          },
          {
            key: "cver";
            value: string;
          },
          {
            key: "yt_li";
            value: "1" | "0";
          },
          {
            key: "GetPlayer_rid";
            value: string;
          },
          {
            key: "yt_ad";
            value: "1" | "0";
          }
        ];
      },
      {
        service: "GUIDED_HELP";
        params: [
          {
            key: "logged_in";
            value: "1" | "0";
          }
        ];
      },
      {
        service: "ECATCHER";
        params: [
          {
            key: "client.version";
            value: string;
          },
          {
            key: "client.name";
            value: "WEB";
          }
        ];
      }
    ];
    webResponseContextExtensionData: {
      hasDecorated: boolean;
    };
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    keywords: string[];
    channelId: string;
    isOwnerViewing: boolean;
    shortDescription: string;
    isCrawlable: boolean;
    thumbnail: Thumbnail;
    averageRating: number;
    allowRatings: boolean;
    viewCount: string;
    author: string;
    isPrivate: boolean;
    isUnpluggedCorpus: boolean;
    isLiveContent?: boolean;
    isLive?: boolean;
    isLiveDvrEnabled?: boolean;
  };
  microformat?: {
    playerMicroformatRenderer: {
      liveBroadcastDetails?: {
        isLiveNow: true;
        startTimestamp: string;
      };
      thumbnail: {
        thumbnails: Thumbnail[];
      };
      embed: {
        iframeUrl: string;
        flashUrl: string;
        width: number;
        height: number;
        flashSecureUrl: string;
      };
      title: {
        simpleText: string;
      };
      description: {
        simpleText: string;
      };
      lengthSeconds: string;
      ownerProfileUrl: string;
      externalChannelId: string;
      availableCountries: string[];
      isUnlisted: boolean;
      hasYpcMetadata: boolean;
      viewCount: string;
      category:
        | "Film & Animation"
        | "Autos & Vehicles"
        | "Music"
        | "Pets & Animals"
        | "Sports"
        | "Travel & Events"
        | "Gaming"
        | "People & Blogs"
        | "Comedy"
        | "Entertainment"
        | "News & Politics"
        | "Howto & Style"
        | "Education"
        | "Science & Technology"
        | "Nonprofits & Activism";
      publishDate: string;
      ownerChannelName: string;
      uploadData: string;
    };
  };
  trackingParams: string;
  cards: {
    allowTeaserDismiss: boolean;
    cardCollectionRenderer: {
      cards: Card[];
      closeButton: {
        infoCardIconRenderer: {
          trackingParams: string;
        };
      };
      headerText: {
        simpleText: string;
      };
      icon: {
        infoCardIconRenderer: {
          trackingParams: string;
        };
      };
      logIconVisibilityUpdates: boolean;
      trackingParams: string;
    };
  };
  attestation?: {
    playerAttestationRenderer: {
      challenge: string;
      botguardData: {
        program: string;
        interpretUrl: string;
        interpreferSafeUrl: {
          privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
        };
      };
    };
  };
  endscreen?: {
    endscreenRenderer: {
      elements: EndScreenElement[];
      trackingParams: string;
    };
  };
  streamingData?: {
    expiresInSeconds: string;
    formats: FormatItem[];
    adaptiveFormats: AdaptiveFormatItem[];
  };
};

export type MusicList = string[];
export type VideoQueue = string[];
export type VideoOnlyList = string[];

export interface StatusProgress {
  [videoId: string]: {
    progressType: "video" | "audio" | "ffmpeg";
    progress: number;
  };
}

export type Tab = {
  // Contains a list of all the videos, either from a /watch page or from a /playlist page.
  videoIdsAvailable?: string[];
  // If the media is a playlist, this is the list of videos to be processed.
  videoIdsToDownload?: string[];
};

// Key-value pairs where each tab ID points at both videos that can be downloaded (when it comes to individual videos) *and* videos that are planned to be downloaded (when it comes to playlists).
export interface TabTracker {
  [tabId: number]: Tab;
}

// Key-value pairs where each video ID points at data that is associated with its download.
export interface VideoDetails {
  [videoId: string]: {
    // The filename of the video.
    filenameOutput: string;
    // The download URLs.
    urls: {
      video: string;
      audio: string;
    };
  };
}

// Key-value pairs where each video points at all of the tab IDs that are associated with it.
export interface VideoIds {
  [videoId: string]: number[];
}

// Used in the pop-up page to reorder videos in the queue
export type MovableList = { id: string; title: string }[];

export interface OptionFileExtension {
  audio: string;
  video: string;
}

export interface Options {
  ext: OptionFileExtension;
  videoQualityMode: "best" | "current-quality" | "custom";
  videoQuality: number;
  isRemoveNativeDownload: boolean;
}
