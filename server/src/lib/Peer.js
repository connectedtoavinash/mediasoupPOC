module.exports = class Peer {
    constructor(socket_id, name) {
        this.id = socket_id;
        this.name = name;
        this.transports = new Map();
        this.consumers = new Map();
        this.producers = new Map();
    }

    addTransport(transport) {
        this.transports.set(transport.id, transport);
        return transport;
    }

    getTransport(transportId) {
        return this.transports.get(transportId);
    }

    addProducer(producer) {
        this.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
            producer.close();
            this.producers.delete(producer.id);
        });
    }

    getProducer(producerId) {
        return this.producers.get(producerId);
    }

    addConsumer(consumer) {
        this.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => {
            this.consumers.delete(consumer.id);
        });
    }

    getConsumer(consumerId) {
        return this.consumers.get(consumerId);
    }

    close() {
        this.transports.forEach((transport) => transport.close());
        this.producers.forEach((producer) => producer.close());
        this.consumers.forEach((consumer) => consumer.close());
    }
};
