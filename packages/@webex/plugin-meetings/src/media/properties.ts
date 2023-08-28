import {ConnectionState, Event} from '@webex/internal-media-core';

import {
  LocalCameraStream,
  LocalMicrophoneStream,
  LocalDisplayStream,
  LocalSystemAudioStream,
  RemoteStream,
} from '@webex/media-helpers';

import {MEETINGS, PC_BAIL_TIMEOUT, QUALITY_LEVELS} from '../constants';
import LoggerProxy from '../common/logs/logger-proxy';

export type MediaDirection = {
  sendAudio: boolean;
  sendVideo: boolean;
  sendShare: boolean;
  receiveAudio: boolean;
  receiveVideo: boolean;
  receiveShare: boolean;
};

/**
 * @class MediaProperties
 */
export default class MediaProperties {
  audioStream?: LocalMicrophoneStream;
  mediaDirection: MediaDirection;
  mediaSettings: any;
  webrtcMediaConnection: any;
  remoteAudioStream: RemoteStream;
  remoteQualityLevel: any;
  remoteShare: RemoteStream;
  remoteVideoStream: RemoteStream;
  shareVideoStream?: LocalDisplayStream;
  shareAudioStream?: LocalSystemAudioStream;
  videoDeviceId: any;
  videoStream?: LocalCameraStream;
  namespace = MEETINGS;

  /**
   * @param {Object} [options] -- to auto construct
   * @returns {MediaProperties}
   */
  constructor() {
    this.webrtcMediaConnection = null;
    this.mediaDirection = {
      receiveAudio: false,
      receiveVideo: false,
      receiveShare: false,
      sendAudio: false,
      sendVideo: false,
      sendShare: false,
    };
    this.videoStream = null;
    this.audioStream = null;
    this.shareVideoStream = null;
    this.shareAudioStream = null;
    this.remoteShare = undefined;
    this.remoteAudioStream = undefined;
    this.remoteVideoStream = undefined;
    this.remoteQualityLevel = QUALITY_LEVELS.HIGH;
    this.mediaSettings = {};
    this.videoDeviceId = null;
  }

  /**
   * Retrieves the preferred video input device
   * @returns {Object|null}
   */
  getVideoDeviceId() {
    return this.videoDeviceId || null;
  }

  setMediaDirection(mediaDirection) {
    this.mediaDirection = mediaDirection;
  }

  setMediaSettings(type, values) {
    this.mediaSettings[type] = values;
  }

  setMediaPeerConnection(mediaPeerConnection) {
    this.webrtcMediaConnection = mediaPeerConnection;
  }

  setLocalVideoStream(videoStream?: LocalCameraStream) {
    this.videoStream = videoStream;
  }

  setLocalAudioStream(audioStream?: LocalMicrophoneStream) {
    this.audioStream = audioStream;
  }

  setLocalShareVideoStream(shareVideoStream?: LocalDisplayStream) {
    this.shareVideoStream = shareVideoStream;
  }

  setLocalShareAudioStream(shareAudioStream?: LocalSystemAudioStream) {
    this.shareAudioStream = shareAudioStream;
  }

  setRemoteQualityLevel(remoteQualityLevel) {
    this.remoteQualityLevel = remoteQualityLevel;
  }

  setRemoteShare(remoteShare: RemoteStream) {
    this.remoteShare = remoteShare;
  }

  /**
   * Sets the remote audio stream
   * @param {RemoteStream} remoteAudioStream RemoteStream to save
   * @returns {void}
   */
  setRemoteAudioStream(remoteAudioStream: RemoteStream) {
    this.remoteAudioStream = remoteAudioStream;
  }

  /**
   * Sets the remote video stream
   * @param {RemoteStream} remoteVideoStream RemoteStream to save
   * @returns {void}
   */
  setRemoteVideoStream(remoteVideoStream: RemoteStream) {
    this.remoteVideoStream = remoteVideoStream;
  }

  /**
   * Stores the preferred video input device
   * @param {string} deviceId Preferred video input device
   * @returns {void}
   */
  setVideoDeviceId(deviceId: string) {
    this.videoDeviceId = deviceId;
  }

  unsetPeerConnection() {
    this.webrtcMediaConnection = null;
  }

  /**
   * Removes both remote audio and video from class instance
   * @returns {void}
   */
  unsetRemoteMedia() {
    this.remoteAudioStream = null;
    this.remoteVideoStream = null;
  }

  unsetRemoteShareStream() {
    this.remoteShareStream = null;
  }

  /**
   * Unsets all remote streams
   * @returns {void}
   */
  unsetRemoteStreams() {
    this.unsetRemoteMedia();
    this.unsetRemoteShareStream();
  }

  /**
   * Returns if we have at least one local share stream or not.
   * @returns {Boolean}
   */
  hasLocalShareStream() {
    return !!(this.shareAudioStream || this.shareVideoStream);
  }

  /**
   * Waits for the webrtc media connection to be connected.
   *
   * @returns {Promise<void>}
   */
  waitForMediaConnectionConnected(): Promise<void> {
    const isConnected = () =>
      this.webrtcMediaConnection.getConnectionState() === ConnectionState.Connected;

    if (isConnected()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let timer;

      const connectionStateListener = () => {
        LoggerProxy.logger.log(
          `Media:properties#waitForMediaConnectionConnected --> connection state: ${this.webrtcMediaConnection.getConnectionState()}`
        );

        if (isConnected()) {
          clearTimeout(timer);
          this.webrtcMediaConnection.off(Event.CONNECTION_STATE_CHANGED, connectionStateListener);
          resolve();
        }
      };

      timer = setTimeout(() => {
        this.webrtcMediaConnection.off(Event.CONNECTION_STATE_CHANGED, connectionStateListener);
        reject();
      }, PC_BAIL_TIMEOUT);

      this.webrtcMediaConnection.on(Event.CONNECTION_STATE_CHANGED, connectionStateListener);
    });
  }

  /**
   * Returns the type of a connection that has been established
   *
   * @returns {Promise<'UDP' | 'TCP' | 'TURN-TLS' | 'TURN-TCP' | 'TURN-UDP' | 'unknown'>}
   */
  async getCurrentConnectionType() {
    // we can only get the connection type after ICE connection has been established
    await this.waitForMediaConnectionConnected();

    const allStatsReports = [];

    try {
      const statsResult = await this.webrtcMediaConnection.getStats();
      statsResult.forEach((report) => allStatsReports.push(report));
    } catch (error) {
      LoggerProxy.logger.warn(
        `Media:properties#getCurrentConnectionType --> getStats() failed: ${error}`
      );
    }

    const successfulCandidatePairs = allStatsReports.filter(
      (report) => report.type === 'candidate-pair' && report.state?.toLowerCase() === 'succeeded'
    );

    let foundConnectionType = 'unknown';

    // all of the successful pairs should have the same connection type, so just return the type for the first one
    successfulCandidatePairs.some((pair) => {
      const localCandidate = allStatsReports.find(
        (report) => report.type === 'local-candidate' && report.id === pair.localCandidateId
      );

      if (localCandidate === undefined) {
        LoggerProxy.logger.warn(
          `Media:properties#getCurrentConnectionType --> failed to find local candidate "${pair.localCandidateId}" in getStats() results`
        );

        return false;
      }

      let connectionType;

      if (localCandidate.relayProtocol) {
        connectionType = `TURN-${localCandidate.relayProtocol.toUpperCase()}`;
      } else {
        connectionType = localCandidate.protocol?.toUpperCase(); // it will be UDP or TCP
      }

      if (connectionType) {
        foundConnectionType = connectionType;

        return true;
      }

      return false;
    });

    return foundConnectionType;
  }
}
