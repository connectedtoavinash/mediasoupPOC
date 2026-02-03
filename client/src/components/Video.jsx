import React, { useRef, useEffect } from 'react';

export const Video = ({ stream, isLocal, muted = false }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    if (!stream && !isLocal) {
        return (
            <div className={`video-wrapper ${isLocal ? 'local-video' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' }}>
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
                    <div>Peer Connected</div>
                    <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>(No Video)</div>
                </div>
            </div>
        );
    }

    return (
        <div className={`video-wrapper ${isLocal ? 'local-video' : ''}`}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal || muted} // Always mute local video to prevent echo
                className="video-element"
            />
            <div className="video-label">
                {isLocal ? 'You' : 'Peer'}
            </div>
        </div>
    );
};
