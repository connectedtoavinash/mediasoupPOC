import React, { useState } from 'react';
import { Landing } from './components/Landing';
import { Room } from './components/Room';

function App() {
  const [roomId, setRoomId] = useState(null);

  const handleJoin = (id) => {
    setRoomId(id);
  };

  const handleLeave = () => {
    setRoomId(null);
    window.location.reload(); // Simple way to reset state
  };

  return (
    <div className="app-container">
      {roomId ? (
        <Room roomId={roomId} onLeave={handleLeave} />
      ) : (
        <Landing onJoin={handleJoin} />
      )}
    </div>
  );
}

export default App;
