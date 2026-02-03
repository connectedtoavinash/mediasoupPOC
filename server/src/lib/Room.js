const config = require('../config');

module.exports = class Room {
    constructor(room_id, worker, io) {
        this.id = room_id;
        this.worker = worker;
        this.io = io;
        this.router = null;
        this.peers = new Map();
    }

    async createRouter() {
        const { mediaCodecs } = config.mediasoup.router;
        this.router = await this.worker.createRouter({ mediaCodecs });
        return this.router;
    }

    addPeer(peer) {
        this.peers.set(peer.id, peer);
    }

    getPeer(socket_id) {
        return this.peers.get(socket_id);
    }

    removePeer(socket_id) {
        const peer = this.peers.get(socket_id);
        if (peer) {
            peer.close();
            this.peers.delete(socket_id);
        }
    }

    async createWebRtcTransport(socket_id, _uuid) {
        const { maxIncomingBitrate, initialAvailableOutgoingBitrate, listenIps } =
            config.mediasoup.webRtcTransport;

        const transport = await this.router.createWebRtcTransport({
            listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate
        });

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                // console.error(error);
            }
        }

        return {
            transport,
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            }
        };
    }
};
