const express = require('express');
const app = express();
const https = require('http'); // Using http for localhost dev
const fs = require('fs');
const path = require('path');
const server = https.createServer(app);
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');
const Room = require('./lib/Room');
const Peer = require('./lib/Peer');

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.get('/', (req, res) => {
    res.send('Mediasoup Server is running (SFU Mode)');
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/dist')));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

let worker;
let rooms = new Map(); // roomId -> Room

// Initialize Mediasoup Worker
async function runMediasoupWorker() {
    try {
        worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        });

        worker.on('died', () => {
            console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
            setTimeout(() => process.exit(1), 2000);
        });

        console.log('Mediasoup worker running');
    } catch (error) {
        console.error('Failed to create Mediasoup worker:', error);
        console.warn('---------------------------------------------------------');
        console.warn('WARNING: Mediasoup Worker failed to start.');
        console.warn('Server is running in SIGNALING-ONLY mode.');
        console.warn('Room joins will work, but Media (Audio/Video) will FAIL.');
        console.warn('---------------------------------------------------------');
    }
}

runMediasoupWorker();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.emit('connection-success', {
        socketId: socket.id
    });

    // 1. Join Room
    socket.on('joinRoom', async ({ roomId }, callback) => {
        let room = rooms.get(roomId);

        // Create room if it doesn't exist
        if (!room) {
            room = new Room(roomId, worker, io);
            if (worker) {
                try {
                    await room.createRouter();
                } catch (err) {
                    console.error('Error creating router:', err);
                }
            }
            rooms.set(roomId, room);
        }

        const peer = new Peer(socket.id, socket.id);
        room.addPeer(peer);

        console.log(`Socket ${socket.id} joined room ${roomId}`);

        // Notify others that a peer joined (Signaling only)
        socket.to(roomId).emit('peer-joined', { socketId: socket.id });

        callback({
            rtpCapabilities: room.router ? room.router.rtpCapabilities : undefined
        });
    });

    // 2. Create WebRtcTransport
    socket.on('createWebRtcTransport', async ({ consumer, roomId }, callback) => {
        const room = rooms.get(roomId);
        if (!room) return callback({ error: 'Room not found' });

        if (!room.router) return callback({ error: 'Media Server Unavailable' });

        const peer = room.getPeer(socket.id);
        if (!peer) return callback({ error: 'Peer not found' });

        try {
            const { transport, params } = await room.createWebRtcTransport(socket.id);

            peer.addTransport(transport);

            callback({ params });
        } catch (err) {
            console.error(err);
            callback({ error: err.message });
        }
    });

    // 3. Connect Transport
    socket.on('transport-connect', async ({ dtlsParameters, serverTransportId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const peer = room.getPeer(socket.id);
        if (!peer) return;

        const transport = peer.getTransport(serverTransportId);
        if (transport) {
            await transport.connect({ dtlsParameters });
        }
    });

    // 4. Produce
    socket.on('transport-produce', async ({ kind, rtpParameters, appData, serverTransportId, roomId }, callback) => {
        const room = rooms.get(roomId);
        if (!room) return callback({ error: 'Room not found' });
        const peer = room.getPeer(socket.id);
        if (!peer) return callback({ error: 'Peer not found' });

        const transport = peer.getTransport(serverTransportId);
        if (transport) {
            const producer = await transport.produce({ kind, rtpParameters, appData });
            peer.addProducer(producer);

            // Notify others
            socket.to(roomId).emit('new-producer', {
                producerId: producer.id,
                socketId: socket.id,
                kind: producer.kind
            });

            producer.on('transportclose', () => {
                producer.close();
            });

            callback({
                id: producer.id,
                producersExist: room.peers.size > 1
            });
        }
    });

    // 5. Consume (Triggered by client after 'new-producer' or initial load)
    socket.on('transport-recv-connect', async ({ dtlsParameters, serverTransportId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const peer = room.getPeer(socket.id);
        if (!peer) return;
        const transport = peer.getTransport(serverTransportId);
        if (transport) {
            await transport.connect({ dtlsParameters });
        }
    });

    socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverTransportId, roomId }, callback) => {
        const room = rooms.get(roomId);
        if (!room) return callback({ error: 'Room not found' });

        if (!room.router) return callback({ error: 'Router not initialized' });

        const peer = room.getPeer(socket.id);
        if (!peer) return callback({ error: 'Peer not found' });
        const transport = peer.getTransport(serverTransportId);

        if (!transport) return callback({ error: 'Transport not found' });

        if (room.router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
            const consumer = await transport.consume({
                producerId: remoteProducerId,
                rtpCapabilities,
                paused: true // Recommendation: Start paused
            });

            peer.addConsumer(consumer);

            consumer.on('transportclose', () => {
                consumer.close();
            });

            consumer.on('producerclose', () => {
                socket.emit('producer-closed', { remoteProducerId });
                consumer.close();
                peer.consumers.delete(consumer.id);
            });

            callback({
                params: {
                    id: consumer.id,
                    producerId: remoteProducerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters
                }
            });
        }
    });

    socket.on('consumer-resume', async ({ serverConsumerId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const peer = room.getPeer(socket.id);
        if (!peer) return;
        const consumer = peer.getConsumer(serverConsumerId);
        if (consumer) {
            await consumer.resume();
        }
    });

    socket.on('getProducers', ({ roomId }, callback) => {
        const room = rooms.get(roomId);
        if (!room) return callback([]);

        let producerList = [];
        room.peers.forEach(peer => {
            // Don't include self
            if (peer.id !== socket.id) {
                peer.producers.forEach(producer => {
                    producerList.push({
                        producerId: producer.id,
                        socketId: peer.id // Use socket id as user identifier
                    });
                });
            }
        });
        callback(producerList);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected', socket.id);
        // Find room and remove peer
        rooms.forEach((room, roomId) => {
            if (room.getPeer(socket.id)) {
                room.removePeer(socket.id);
                socket.to(roomId).emit('peer-left', { socketId: socket.id });
                if (room.peers.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
});

const port = 3001;
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
