import React, { useState } from 'react';

export const Landing = ({ onJoin }) => {
    const [roomId, setRoomId] = useState('');

    const handleCreate = () => {
        const randomId = Math.random().toString(36).substring(7);
        onJoin(randomId);
    };

    const handleJoin = (e) => {
        e.preventDefault();
        if (roomId.trim()) {
            onJoin(roomId);
        }
    };

    return (
        <div className="landing-container">
            <div className="landing-card">
                <h1 className="landing-title">
                    Mediasoup Demo
                </h1>

                <div className="landing-actions">
                    <button
                        onClick={handleCreate}
                        className="btn btn-primary"
                    >
                        Create New Room
                    </button>

                    <div className="divider">
                        <span className="divider-text">Or join existing</span>
                    </div>

                    <form onSubmit={handleJoin} className="join-form">
                        <input
                            type="text"
                            placeholder="Enter Room Code"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            className="input-field"
                        />
                        <button
                            type="submit"
                            className="btn btn-secondary"
                        >
                            Join Room
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};
