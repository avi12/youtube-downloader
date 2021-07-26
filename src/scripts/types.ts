type Thumbnail = {
  thumbnails: {
    url: string;
    width: number;
    height: number;
  }[];
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
      accessibility: {
        accessibilityData: {
          label: string;
        };
      };
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
    style: string;
    image: Thumbnail;
    videoDuration: {
      accessibility: {
        accessibilityData: {
          label: string;
        };
      };
      simpleText: string;
    };
    left: number;
    width: number;
    top: number;
    aspectRatio: number;
    startMs: number;
    endMs: number;
    title: {
      accessibility: {
        accessibilityData: {
          label: string;
        };
      };
      simpleText: string;
    };
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

type FormatItem = MediaItem & {
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
  quality:
    | "tiny"
    | "medium"
    | "large"
    | "hd720"
    | "hd1080"
    | "hd1440"
    | "hd2160"
    | "hd4320";
  fps?: 30 | 48 | 50 | 60;
  qualityLabel?:
    | "144p"
    | "360p"
    | "480p"
    | "720p"
    | "1080p"
    | "1440p"
    | "2160p"
    | "4320p";
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

export type PlayerResponse = {
  responseContext: {
    serviceTrackingParams: [
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
            value: "0x20481bfe7c1042a6";
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
    mainAppWebResponseContext: {
      datasyncId: string;
      loggedOut: boolean;
    };
    webResponseContextExtensionData: {
      hasDecorated: boolean;
    };
  };
  storyboards: {
    playerStoryboardSpecRenderer?: {
      spec: string;
    };
    playerLiveStoryboardRenderer?: {
      spec: string;
    };
  };
  playabilityStatus: {
    status: "OK" | "UNPLAYABLE";
    reason?: "Video unavailable";
    errorScreen?: {
      playerErrorMessageRenderer: {
        reason: {
          simpleText: "Video unavailable";
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
        thumbnail: Thumbnail;
      };
      thumbnail: Thumbnail;
      icon: {
        iconType: "ERROR_OUTLINE";
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
  videoDetails: {
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
  trackingParams: string;
  cards: {
    cardCollectionRenderer: {
      cards: Card[];
      headerText: {
        simpleText: string;
      };
      icon: {
        infoCardIconRenderer: {
          trackingParams: string;
        };
      };
      closeButton: {
        infoCardIconRenderer: {
          trackingParams: string;
        };
      };
      trackingParams: string;
      allowTeaserDismiss: boolean;
      logIconVisibilityUpdates: boolean;
    };
  };
  attestation: {
    playerAttestationRenderer: {
      challenge: string;
      botguardData: {
        program: string;
        interpretUrl: string;
      };
    };
  };
  endscreen: {
    endscreenRenderer: {
      elements: EndScreenElement[];
      trackingParams: string;
    };
  };
  streamingData: {
    expiresInSeconds: string;
    formats: FormatItem[];
    adaptiveFormats: AdaptiveFormatItem[];
  };
};

export interface VideoData {
  csn: string;
  root_ve_type: number;
  vss_host: string;
  cr: string;
  host_language: string;
  hl: string;
  gapi_hint_params: {
    gapi_hint_params: {
      "m;/_/scs/abc-static/_/js/k": {
        "gapi.gapi.en.RrjSsKk8Szw.0/d": {
          "1/ct": {
            "zgms/rs": {
              "AHpOoo8bhQb3qTfNhmC8kzOOB-dQGGlNzA/m": "__features__";
            };
          };
        };
      };
    };
  };
  innertube_api_key: string;
  innertube_api_version: string;
  innertube_context_client_version: string;
  watermark: string;
  c: string;
  cver: string;
  cbr: string;
  cbrver: string;
  cos: string;
  cosver: number;
  player_response: PlayerResponse;
  enablecsi: 1 | 0;
  csi_page_type: string;
  use_miniplayer_ui: 1 | 0;
  ps: string;
  fexp: string;
  fflags: {
    autoplay_time: number;
    html5_sticky_reduces_discount_by: number;
    web_player_innertube_subscription_update: boolean;
    html5_log_rebuffer_events: number;
    ensure_only_one_resolved_midroll_response_on_web: boolean;
    web_foreground_heartbeat_interval_ms: number;
    html5_aspect_from_adaptive_format: boolean;
    player_destroy_old_version: boolean;
    html5_max_live_dvr_window_plus_margin_secs: number;
    player_bootstrap_method: boolean;
    html5_av1_thresh_arm: number;
    html5_hdcp_probing_stream_url: number;
    html5_decode_to_texture_cap: boolean;
    web_logging_max_batch: number;
    html5_check_segnum_discontinuity: boolean;
    flush_gel: boolean;
    kevlar_miniplayer: boolean;
    enable_auto_play_param_fix_for_masthead_ad: boolean;
    html5_manifestless_vp9: boolean;
    check_navigator_accuracy_timeout_ms: number;
    web_csi_client_defined_timer: boolean;
    html5_gapless_ended_transition_buffer_ms: number;
    mdx_load_cast_api_bootstrap_script: boolean;
    html5_random_playback_cap: number;
    html5_gl_fps_threshold: number;
    html5_safari_desktop_eme_min_version: number;
    tvhtml5_min_has_advanced_secs_float: number;
    enable_gel_log_commands: boolean;
    music_enable_shared_audio_tier_logic: boolean;
    html5_subsegment_readahead_seek_latency_fudge: number;
    html5_seek_timeout_delay_ms: number;
    html5_ios7_force_play_on_stall: boolean;
    html5_enable_embedded_player_visibility_signals: boolean;
    log_window_onerror_fraction: number;
    mweb_cougar_big_controls: boolean;
    html5_log_timestamp_offset: boolean;
    html5_health_to_gel: boolean;
    web_player_include_innertube_commands: boolean;
    desktop_action_companion_wta_support: boolean;
    kevlar_command_handler_command_banlist: string;
    enable_cast_for_web_unplugged: boolean;
    addto_ajax_log_warning_fraction: number;
    leader_election_check_interval: 9000;
    should_clear_video_data_on_player_cued_unstarted: boolean;
    enable_client_page_id_header_for_first_party_pings: boolean;
    skip_ad_button_with_thumbnail: boolean;
    mweb_native_control_in_faux_fullscreen_shared: boolean;
    web_player_response_playback_tracking_parsing: boolean;
    web_api_url: boolean;
    html5_av1_thresh: number;
    web_player_gvi_wexit_web: boolean;
    use_remote_context_in_populate_remote_client_info: boolean;
    html5_ios4_seek_above_zero: boolean;
    embeds_impression_link: boolean;
    html5_skip_slow_ad_delay_ms: number;
    html5_hfr_quality_cap: number;
    html5_default_ad_gain: number;
    web_player_touch_mode_improvements: boolean;
    enable_client_deferred_full_screen_filtering_for_mweb_phones: boolean;
    html5_suspend_loader: boolean;
    html5_post_interrupt_readahead: number;
    manifestless_post_live_ufph: boolean;
    html5_performance_cap_floor: number;
    disable_channel_id_check_for_suspended_channels: boolean;
    leader_election_lease_ttl: number;
    suppress_error_204_logging: boolean;
    web_gel_debounce_ms: number;
    kevlar_playback_associated_queue: boolean;
    disable_new_pause_state3: boolean;
    html5_restrict_streaming_xhr_on_sqless_requests: boolean;
    variable_buffer_timeout_ms: number;
    html5_ignore_bad_bitrates: boolean;
    hoffle_cache_size_secs: number;
    html5_offline_av1_fallback: boolean;
    html5_player_dynamic_bottom_gradient: boolean;
    web_playback_associated_log_ctt: boolean;
    html5_stop_video_in_cancel_playback: boolean;
    html5_background_cap_idle_secs: number;
    html5_new_element_on_invalid_state: boolean;
    debug_sherlog_username: number;
    html5_enable_video_overlay_on_inplayer_slot_for_tv: boolean;
    csi_on_gel: boolean;
    polymer_bad_build_labels: boolean;
    web_inline_player_disable_scrubbing: boolean;
    html5_perserve_av1_perf_cap: boolean;
    autoplay_time_for_music_content_after_autoplayed_video: number;
    html5_player_min_build_cl: number;
    web_player_api_logging_fraction: number;
    embeds_enable_age_gating_playability_check: boolean;
    html5_vp9_mime_full_range_flag: boolean;
    new_codecs_string_api_uses_legacy_style: boolean;
    html5_request_size_padding_secs: number;
    html5_no_placeholder_rollbacks: boolean;
    web_op_continuation_type_banlist: string;
    hoffle_max_video_duration_secs: number;
    html5_qoe_user_intent_match_health: boolean;
    html5_expanded_max_vss_pings: boolean;
    html5_store_xhr_headers_readable: boolean;
    html5_av1_thresh_hcc: number;
    web_player_gvi_wexit_living_room_kids: boolean;
    mweb_enable_custom_control_shared: boolean;
    html5_request_sizing_multiplier: number;
    html5_gapless_ad_byterate_multiplier: number;
    html5_source_buffer_attach_retry_limit: number;
    html5_experiment_id_label: number;
    html5_minimum_readahead_seconds: number;
    polymer_verifiy_app_state: boolean;
    html5_subsegment_readahead_min_load_speed: number;
    web_player_inline_botguard: boolean;
    html5_enable_eac3: boolean;
    web_player_nitrate_promo_tooltip: boolean;
    gvi_channel_client_screen: boolean;
    html5_varispeed_playback_rate: boolean;
    html5_unrewrite_timestamps: boolean;
    html5_max_selectable_quality_ordinal: number;
    set_interstitial_advertisers_question_text: boolean;
    enable_web_pes: boolean;
    html5_seek_jiggle_cmt_delay_ms: number;
    html5_gapless_seek_tolerance_secs: number;
    html5_sync_seeking_state: boolean;
    html5_process_all_encrypted_events: boolean;
    offline_error_handling: boolean;
    preskip_button_style_ads_backend: string;
    is_kevlar_wexit_main_launch: boolean;
    html5_error_cooldown_in_ms: number;
    html5_not_vp9_supported_quality_cap: number;
    playready_first_play_expiration: number;
    html5_vp9_new_mime: boolean;
    html5_dynamic_av1_hybrid_threshold: boolean;
    html5_manifestless_max_segment_history: number;
    html5_reset_index_on_mismatch: boolean;
    log_js_exceptions_fraction: number;
    html5_live_abr_head_miss_fraction: number;
    html5_unify_sqless_flow: boolean;
    web_player_vss_pageid_header: boolean;
    cb_v2_uxe: number;
    html5_long_rebuffer_threshold_ms: number;
    html5_log_audio_abr: boolean;
    web_log_connection: boolean;
    html5_probe_live_using_range: boolean;
    html5_ads_preroll_lock_timeout_delay_ms: number;
    web_player_ss_media_time_offset: boolean;
    html5_platform_whitelisted_for_frame_accurate_seeks: boolean;
    web_player_gvi_wexit_mweb: boolean;
    set_interstitial_start_button: boolean;
    www_for_videostats: boolean;
    html5_in_buffer_ptl_timeout_ms: number;
    release_player_on_abandon_for_bulleit_lr_ads_frontend: boolean;
    html5_autonav_cap_idle_secs: number;
    html5_non_network_rebuffer_duration_ms: number;
    nwl_send_fast_on_unload: boolean;
    html5_ad_timeout_ms: number;
    html5_prefer_server_bwe3: boolean;
    html5_delay_initial_loading: boolean;
    html5_default_quality_cap: number;
    is_mweb_wexit_main_launch: boolean;
    disable_thumbnail_preloading: boolean;
    html5_gapless_max_played_ranges: number;
    enable_svg_mode_on_embed_mobile: boolean;
    disable_simple_mixed_direction_formatted_strings: boolean;
    html5_min_readbehind_cap_secs: number;
    web_player_innertube_share_panel: boolean;
    html5_heartbeat_set_ended: boolean;
    hfr_dropped_framerate_fallback_threshold: number;
    html5_autonav_quality_cap: number;
    html5_rewrite_manifestless_for_sync: boolean;
    html5_license_constraint_delay: number;
    html5_deprecate_video_tag_pool: boolean;
    self_podding_midroll_choice_string_template: string;
    deprecate_pair_servlet_enabled: boolean;
    html5_live_abr_repredict_fraction: number;
    html5_jumbo_mobile_subsegment_readahead_target: number;
    short_start_time_prefer_publish_in_watch_log: boolean;
    html5_desktop_vr180_allow_panning: boolean;
    web_client_version_override: number;
    html5_max_drift_per_track_secs: number;
    html5_decoder_freeze_timeout_delay_ms: number;
    web_yt_config_context: boolean;
    html5_min_has_advanced_secs: number;
    html5_live_ultra_low_latency_bandwidth_window: number;
    html5_pause_on_nonforeground_platform_errors: boolean;
    html5_background_quality_cap: number;
    external_fullscreen_with_edu: boolean;
    html5_gapless_preloading: boolean;
    html5_ios_force_seek_to_zero_on_stop: boolean;
    web_player_innertube_playlist_update: boolean;
    html5_reload_element_long_rebuffer_delay_ms: number;
    kevlar_autonav_miniplayer_fix: boolean;
    player_ads_set_adformat_on_client: boolean;
    html5_in_buffer_ptl: boolean;
    autoplay_time_for_music_content: number;
    html5_disable_non_contiguous: boolean;
    html5_subsegment_readahead_load_speed_check_interval: number;
    html5_video_tbd_min_kb: number;
    live_chunk_readahead: number;
    self_podding_highlighted_button_blue: boolean;
    html5_peak_shave: boolean;
    align_ad_to_video_player_lifecycle_for_bulleit: boolean;
    web_deprecate_service_ajax_map_dependency: boolean;
    web_player_gvi_wexit_living_room_simply: boolean;
    html5_release_on_error: boolean;
    html5_use_current_media_time_for_glrem_gllat: boolean;
    disable_legacy_desktop_remote_queue: boolean;
    web_op_endpoint_banlist: string;
    html5_seek_over_discontinuities: boolean;
    html5_subsegment_readahead_timeout_secs: number;
    html5_df_downgrade_thresh: number;
    html5_check_both_ad_active_and_ad_info: boolean;
    html5_autoplay_default_quality_cap: number;
    html5_fludd_suspend: boolean;
    web_log_connection_in_gel: boolean;
    manifestless_post_live: boolean;
    web_player_music_visualizer_treatment: string;
    ytidb_transaction_try_count: number;
    kevlar_gel_error_routing: boolean;
    kevlar_allow_multistep_video_init: boolean;
    html5_subsegment_readahead_target_buffer_health_secs: number;
    web_player_gvi_wexit_embeds: boolean;
    html5_probe_secondary_during_timeout_miss_count: number;
    circle_crop_both_discovery_and_masthead_companion_thumbnail: boolean;
    html5_log_live_discontinuity: boolean;
    html5_min_selectable_quality_ordinal: number;
    html5_probe_primary_delay_base_ms: number;
    enable_mixed_direction_formatted_strings: boolean;
    mdx_enable_privacy_disclosure_ui: boolean;
    html5_enable_ac3: boolean;
    html5_allow_video_keyframe_without_audio: boolean;
    html5_new_elem_on_hidden: boolean;
    disable_features_for_supex: boolean;
    html5_subsegment_readahead_min_buffer_health_secs: number;
    web_forward_command_on_pbj: boolean;
    enable_topsoil_wta_for_halftime: boolean;
    html5_encourage_array_coalescing: boolean;
    web_player_ss_dai_ad_fetching_timeout_ms: number;
    html5_block_pip_safari_delay: number;
    html5_seek_new_elem_delay_ms: number;
    web_player_move_autonav_toggle: boolean;
    html5_long_rebuffer_jiggle_cmt_delay_ms: number;
    html5_enable_tvos_encrypted_vp9: boolean;
    html5_platform_minimum_readahead_seconds: number;
    html5_maximum_readahead_seconds: number;
    fast_autonav_in_background: boolean;
    html5_live_normal_latency_bandwidth_window: number;
    html5_min_has_advanced_secs_float: number;
    networkless_logging: boolean;
    html5_unreported_seek_reseek_delay_ms: number;
    embeds_enable_embed_module: boolean;
    html5_jumbo_ull_nonstreaming_mffa_ms: number;
    player_allow_autonav_after_playlist: boolean;
    kevlar_miniplayer_expand_top: boolean;
    fix_ads_tracking_for_swf_config_deprecation_mweb: boolean;
    html5_report_slow_ads_as_error: boolean;
    web_player_ipp_canary_type_for_logging: number;
    desktop_player_button_tooltip_with_shortcut: boolean;
    web_enable_ad_signals_in_it_context: boolean;
    html5_min_readbehind_secs: number;
    web_lifecycles: boolean;
    player_endscreen_ellipsis_fix: boolean;
    web_player_gvi_wexit_other: boolean;
    live_fresca_v2: boolean;
    tvhtml5_unplugged_preload_cache_size: number;
    leader_election_renewal_interval: number;
    html5_log_experiment_id_from_player_response_to_ctmp: number;
    embeds_wexit_list_ajax_migration: boolean;
    nwl_latency_sampling_rate: number;
    mweb_csi_watch_fix: boolean;
    html5_perf_cap_override_sticky: boolean;
    html5_jumbo_ull_subsegment_readahead_target: number;
    max_resolution_for_white_noise: number;
    html5_subsegment_readahead_min_buffer_health_secs_on_timeout: number;
    delay_ads_gvi_call_on_bulleit_living_room_ms: number;
    enable_eviction_protection_for_bulleit: boolean;
    self_podding_highlight_non_default_button: boolean;
    html5_media_fullscreen: boolean;
    html5_quality_cap_min_age_secs: number;
    html5_deadzone_multiplier: number;
    nwl_cleaning_rate: number;
    web_gel_timeout_cap: boolean;
    html5_start_seconds_priority: boolean;
    html5_seek_set_cmt_delay_ms: number;
    html5_manifestless_vp9_otf: boolean;
    allow_poltergust_autoplay: boolean;
    html5_disable_move_pssh_to_moov: boolean;
    self_podding_header_string_template: string;
    html5_hack_gapless_init: boolean;
    html5_time_based_consolidation_ms: number;
    html5_urgent_adaptation_fix: boolean;
    player_web_canary_stage: number;
    html5_set_ended_in_pfx_live: boolean;
    log_final_payload: boolean;
    html5_remove_not_servable_check_killswitch: boolean;
    html5_max_readbehind_secs: number;
    log_web_endpoint_to_layer: boolean;
    web_player_gvi_wexit_living_room_unplugged: boolean;
    html5_request_only_hdr_or_sdr_keys: boolean;
    html5_allowable_liveness_drift_chunks: number;
    ad_pod_disable_companion_persist_ads_quality: boolean;
    player_doubletap_to_seek: boolean;
    desktop_sparkles_light_cta_button: boolean;
    html5_max_headm_for_streaming_xhr: number;
    web_player_live_monitor_env: boolean;
    unplugged_tvhtml5_video_preload_on_focus_delay_ms: number;
    html5_manifestless_seg_drift_limit_secs: number;
    html5_static_abr_resolution_shelf: number;
    html5_unschedule_companions_with_terminated_video_ad: boolean;
    web_player_ss_timeout_skip_ads: boolean;
    enable_midroll_prefetch_for_html5: boolean;
    pageid_as_header_web: boolean;
    kevlar_dropdown_fix: boolean;
    networkless_gel: boolean;
    html5_drm_initial_constraint_from_config: boolean;
    web_player_watch_next_response: boolean;
    mweb_muted_autoplay_animation: string;
    ytidb_transaction_ended_event_rate_limit: number;
    botguard_async_snapshot_timeout_ms: number;
    html5_gapless_no_requests_after_lock: boolean;
    kevlar_miniplayer_play_pause_on_scrim: boolean;
    self_podding_pod_choice_string_template: string;
    html5_live_low_latency_bandwidth_window: number;
    kabuki_pangea_prefer_audio_only_for_atv_and_uploads: boolean;
    html5_av1_thresh_lcc: number;
    web_new_autonav_countdown: boolean;
    html5_buffer_health_to_defer_slice_processing: number;
    html5_manifestless_media_source_duration: 25200;
    html5_max_readahead_bandwidth_cap: number;
    html5_crypto_period_secs_from_emsg: boolean;
    use_video_ad_break_offset_ms_int64: boolean;
    enable_live_premiere_web_player_indicator: boolean;
    html5_readahead_ratelimit: number;
    html5_stateful_audio_min_adjustment_value: number;
    mweb_enable_skippables_on_jio_phone: boolean;
    kevlar_frontend_video_list_actions: boolean;
    html5_source_buffer_attach_delay_time: number;
    unplugged_tvhtml5_botguard_attestation: boolean;
    custom_csi_timeline_use_gel: boolean;
    dash_manifest_version: number;
    allow_live_autoplay: boolean;
    html5_live_quality_cap: number;
    enable_preoll_prefetch: boolean;
    web_player_show_music_in_this_video_graphic: string;
    html5_disable_reset_on_append_error: boolean;
    embeds_enable_intersection_observer_v2: boolean;
    html5_qoe_intercept: number;
    error_message_for_gsuite_network_restrictions: boolean;
    disable_child_node_auto_formatted_strings: boolean;
    enable_ypc_clickwrap_on_living_room: boolean;
    html5_workaround_delay_trigger: boolean;
    player_enable_playback_playlist_change: boolean;
    html5_rewrite_manifestless_for_continuity: boolean;
    network_polling_interval: number;
    enable_nwl_cleaning_logic: boolean;
    use_inlined_player_rpc: boolean;
    web_op_signal_type_banlist: string;
    tvhtml5_disable_live_prefetch: boolean;
    web_player_sentinel_is_uniplayer: boolean;
    html5_defer_slicing: boolean;
    html5_pacf_enable_dai: boolean;
    kevlar_queue_use_dedicated_list_type: boolean;
    html5_player_autonav_logging: boolean;
    web_player_watch_next_response_parsing: boolean;
    kevlar_queue_use_update_api: boolean;
    web_player_variant_noop: boolean;
  };
  errorcode?: number;
  reason?: string;
  status: "ok" | "fail";
}
