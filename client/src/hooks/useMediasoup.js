import { useState, useRef, useEffect, useCallback } from 'react';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';

const config = {
    // Use http for localhost dev if not using https
    // In production this must be https for getUserMedia
    routerRtpCapabilities: null
};

export const useMediasoup = (roomId) => {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStreams, setRemoteStreams] = useState(new Map()); // socketId -> stream
    const [connectionState, setConnectionState] = useState('disconnected'); // disconnected, connected, joined

    const socketRef = useRef(null);
    const deviceRef = useRef(null);
    const producerTransportRef = useRef(null);
    const consumerTransportRef = useRef(null);
    const producersRef = useRef(new Map()); // kind -> producer
    const consumersRef = useRef(new Map()); // producerId -> consumer

    const getLocalStream = async () => {
        try {
            if (localStream) return localStream;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
            setLocalStream(stream);
            return stream;
        } catch (err) {
            console.error('Failed to get local stream', err);
        }
    };

    const initialize = useCallback(async () => {
        socketRef.current = io('http://localhost:3001'); // Configure URL as needed

        socketRef.current.on('connect', () => {
            console.log('Socket connected');
            setConnectionState('connected');
        });

        socketRef.current.on('connection-success', ({ socketId }) => {
            console.log('My socket ID:', socketId);
        });

        // Listen for new producers
        socketRef.current.on('new-producer', ({ producerId, socketId, kind }) => {
            console.log('New remote producer:', producerId, kind, 'from', socketId);
            consume(producerId, socketId);
        });

        socketRef.current.on('peer-left', ({ socketId }) => {
            console.log('Peer left:', socketId);
            setRemoteStreams((prev) => {
                const newMap = new Map(prev);
                newMap.delete(socketId);
                return newMap;
            });
        });

        socketRef.current.on('peer-joined', ({ socketId }) => {
            console.log('Peer joined (Signaling):', socketId);
            setRemoteStreams(prev => {
                const newMap = new Map(prev);
                // In signaling only mode, we might not have a stream, but we want to show the user exists
                // We can use a null stream or a placeholder
                if (!newMap.has(socketId)) {
                    newMap.set(socketId, null);
                }
                return newMap;
            });
        });

        return () => {
            socketRef.current.disconnect();
        };
    }, []);

    const joinRoom = async () => {
        if (!roomId) return;

        socketRef.current.emit('joinRoom', { roomId }, async (data) => {
            console.log('Router RTP Capabilities:', data.rtpCapabilities);

            // Always get local stream so user sees themselves
            try {
                await getLocalStream();
            } catch (e) {
                console.error('Error getting local stream:', e);
            }

            if (!data.rtpCapabilities) {
                console.warn('Server does not support media (Signaling Only Mode)');
                setConnectionState('joined'); // Join anyway for chat/signaling
                return;
            }

            await loadDevice(data.rtpCapabilities);

            // Once device is loaded, create transport
            await createSendTransport();

            // Retrieve existing producers
            socketRef.current.emit('getProducers', { roomId }, (producers) => {
                producers.forEach(({ producerId, socketId }) => {
                    consume(producerId, socketId);
                });
            });

            setConnectionState('joined');
        });
    };

    const loadDevice = async (routerRtpCapabilities) => {
        try {
            deviceRef.current = new Device();
            await deviceRef.current.load({ routerRtpCapabilities });
        } catch (error) {
            console.error('Failed to load device:', error);
            if (error.name === 'UnsupportedError') {
                console.warn('Browser not supported');
            }
        }
    };

    const createSendTransport = async () => {
        socketRef.current.emit('createWebRtcTransport', { consumer: false, roomId }, async ({ params }) => {
            if (params.error) {
                console.error(params.error);
                return;
            }

            producerTransportRef.current = deviceRef.current.createSendTransport(params);

            producerTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    socketRef.current.emit('transport-connect', {
                        dtlsParameters,
                        serverTransportId: params.id,
                        roomId
                    });
                    callback();
                } catch (error) {
                    errback(error);
                }
            });

            producerTransportRef.current.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                try {
                    socketRef.current.emit('transport-produce', {
                        kind,
                        rtpParameters,
                        appData,
                        serverTransportId: params.id,
                        roomId
                    }, ({ id }) => {
                        callback({ id });
                    });
                } catch (error) {
                    errback(error);
                }
            });

            // Start producing immediately (Audio + Video)
            await produce('audio');
            await produce('video');
        });
    };

    const createRecvTransport = async () => {
        // Only create one consumer transport
        if (consumerTransportRef.current) return consumerTransportRef.current;

        return new Promise((resolve) => {
            socketRef.current.emit('createWebRtcTransport', { consumer: true, roomId }, async ({ params }) => {
                if (params.error) {
                    console.error(params.error);
                    return;
                }

                consumerTransportRef.current = deviceRef.current.createRecvTransport(params);

                consumerTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    try {
                        socketRef.current.emit('transport-recv-connect', {
                            dtlsParameters,
                            serverTransportId: params.id,
                            roomId
                        });
                        callback();
                    } catch (error) {
                        errback(error);
                    }
                });

                resolve(consumerTransportRef.current);
            });
        });
    };

    const produce = async (type) => {
        try {
            let stream = localStream;
            // Manage local stream state
            if (!stream) {
                stream = await getLocalStream();
            }

            if (!stream) return;

            let track;
            if (type === 'audio') track = stream.getAudioTracks()[0];
            if (type === 'video') track = stream.getVideoTracks()[0];

            if (!track) return;

            const producer = await producerTransportRef.current.produce({ track });
            producersRef.current.set(type, producer);

            producer.on('trackended', () => {
                console.log('track ended');
                // close producer
            });

            producer.on('transportclose', () => {
                console.log('transport closed');
            });

        } catch (err) {
            console.error('Produce error:', err);
        }
    };

    const consume = async (remoteProducerId, socketId) => {
        const device = deviceRef.current;
        const routerRtpCapabilities = device.rtpCapabilities;

        // Ensure Recv Transport exists
        await createRecvTransport();
        const transport = consumerTransportRef.current;

        socketRef.current.emit('consume', {
            rtpCapabilities: routerRtpCapabilities,
            remoteProducerId,
            serverTransportId: transport.id,
            roomId
        }, async ({ params }) => {
            if (params.error) {
                console.error('Cannot consume:', params.error);
                return;
            }

            const consumer = await transport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters
            });

            consumersRef.current.set(consumer.id, consumer);

            // Resume server side
            socketRef.current.emit('consumer-resume', {
                serverConsumerId: params.id,
                roomId
            });

            // Handle stream
            const { track } = consumer;
            const newStream = new MediaStream([track]);

            // Update remote streams map
            setRemoteStreams(prev => {
                const newMap = new Map(prev);
                // We might want to group tracks by socketId later, but for now just one stream per track or combine them
                // If we already have a stream for this socketId, add the track
                if (newMap.has(socketId)) {
                    const existingStream = newMap.get(socketId);
                    existingStream.addTrack(track);
                    return newMap; // Force update
                } else {
                    newMap.set(socketId, newStream);
                    return newMap;
                }
            });
        });
    };

    const toggleMic = () => {
        const audioProducer = producersRef.current.get('audio');
        // If no producer (signaling only mode), we might want to mute the local track directly
        if (audioProducer) {
            if (audioProducer.paused) {
                audioProducer.resume();
            } else {
                audioProducer.pause();
            }
        } else if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) track.enabled = !track.enabled;
        }
    };

    const toggleCam = () => {
        const videoProducer = producersRef.current.get('video');
        // If no producer (signaling only mode), we might want to mute the local track directly
        if (videoProducer) {
            if (videoProducer.paused) {
                videoProducer.resume();
            } else {
                videoProducer.pause();
            }
        } else if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) track.enabled = !track.enabled;
        }
    };

    const shareScreen = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const track = stream.getVideoTracks()[0];

            // If in signaling only mode, we just show it locally and return
            if (!deviceRef.current) {
                setLocalStream(stream); // Replace local video with screen share for demo

                track.onended = () => {
                    getLocalStream().then(s => setLocalStream(s));
                };
                return;
            }

            const producer = await producerTransportRef.current.produce({ track });
            producersRef.current.set('screen', producer);

            producer.on('trackended', () => {
                // Stop screen share
                producer.close();
                producersRef.current.delete('screen');
            });

            track.onended = () => {
                producer.close();
            };

        } catch (error) {
            console.error('Error sharing screen:', error);
        }
    };

    return {
        initialize,
        joinRoom,
        localStream,
        remoteStreams,
        connectionState,
        toggleMic,
        toggleCam,
        shareScreen
    };
};
