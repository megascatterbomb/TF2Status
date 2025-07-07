import React, { useEffect, useState } from 'react';

type ServerQuery = {
    serverName: string;
    onlinePlayers: number;
    maxPlayers: number;
    password: boolean;
    map: string;
    sdr: boolean;
};

type ServerData = {
    id: string;
    result: ServerQuery[];
};

function getStatus(results: ServerQuery[]): string {
    if (results.length === 0) return '🟡 Attempting to contact...';

    const latest = results[results.length - 1];
    if (latest.maxPlayers === 0) {
        if (results.length === 1 || results[results.length - 2].maxPlayers === 0) {
            return '🔴 Offline';
        }
        return '🟡 Interrupted';
    }

    if (latest.password) {
        return '🔒 Password Protected';
    }

    if (latest.onlinePlayers === latest.maxPlayers) {
        return '🔵 Full';
    }
    return '🟢 Online';
}

const ServerStatusPage: React.FC = () => {
    const [data, setData] = useState<ServerData[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then((json: ServerData[]) => {
                setData(json);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, []);

    if (loading) return <p>Loading server status...</p>;
    if (error) return <p>Error loading data: {error}</p>;
    if (!data) return <p>No data available.</p>;

    return (
        <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
            <h1>🌐 Server Status Dashboard</h1>
            {data.map((d) => {
                const { id, result } = d;
                const latest = result[result.length - 1];
                return (
                    <div key={id} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}>
                        <h2>{latest.serverName || 'Offline'}</h2>
                        <p><strong>Address:</strong> {id}</p>
                        <p><strong>Map:</strong> {latest.map}</p>
                        <p><strong>Players:</strong> {latest.onlinePlayers} / {latest.maxPlayers}</p>
                        <p><strong>Status:</strong> {getStatus(result)}</p>
                    </div>
                );
            })}
        </div>
    );
};

export default ServerStatusPage;
