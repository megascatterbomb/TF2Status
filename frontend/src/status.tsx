import React, { useEffect, useState } from 'react';
import tutorial from './tutorial';
import type { ExternalLink } from './externalLinks';
import externalLinks from './externalLinks';
import axios from 'axios';

type ServerResult = {
  serverName: string;
  serverAddress: string;
  onlinePlayers: number;
  maxPlayers: number;
  password: boolean;
  externalLinks: ExternalLink[];
  map: string;
  sdr: boolean;
};

type ServerData = {
  id: string;
  results: ServerResult[];
};

type APIQuery = {
  externalLinks: ExternalLink[];
  servers: ServerData[];
  redirectIP?: string;
}

function getStatus(results: ServerResult[]): string {
  if (results.length === 0) return '🟡 Attempting to contact...';

  const latest = results[results.length - 1];
  if (latest.maxPlayers === 0) {
    if (results.length === 1 || results[results.length - 2].maxPlayers === 0) {
      return '🔴 Offline';
    }
    return '🟡 Disrupted';
  }

  if (latest.password) {
    return '🔒 Password Protected';
  }

  if (latest.onlinePlayers === latest.maxPlayers) {
    return '🔵 Full';
  }
  return '🟢 Online';
}

function getButtons(serverAddress: string, sdr: boolean, redirectIP?: string): React.ReactNode {
  const tooltipText = "You need to use the console command to connect to this server.";
  const disabled = !serverAddress || (sdr && !redirectIP);
  return (
    <>
      <div style={{ display: "flex", gap: "1rem", justifyContent: 'center' }}>
        <div className="tooltip-wrapper">
          <button
            className={disabled ? "disabled" : ""}
            disabled={disabled}
            onClick={() => {
              if (!serverAddress) return;
              if (sdr) { // use potato.tf redirect server
                window.open(`https://potato.tf/connect/${redirectIP}/dest=${serverAddress}`, '_blank');
              } else {
                window.open(`steam://connect/${serverAddress}`, '_blank');
              }
            }}
          >
            Join server
          </button>

          {disabled && <span className="tooltip">{tooltipText}</span>}
        </div>
        <button
          onClick={() => {
            if (serverAddress) {
              navigator.clipboard.writeText(`connect ${serverAddress}`)
            }
          }}
        >
          Copy connect command
        </button>
      </div>
    </>
  );
}


const ServerStatusPage: React.FC = () => {
  const [data, setData] = useState<APIQuery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    axios.get<APIQuery>('/api')
      .then((response) => {
        setData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();

    const nextRefreshDelay = 10000

    const timeout = setTimeout(() => {
      fetchData();
      const interval = setInterval(fetchData, nextRefreshDelay);
      return () => clearInterval(interval);
    }, nextRefreshDelay);

    return () => clearTimeout(timeout);
  }, []);

  if (loading) return <p>Loading server status...</p>;
  if (error) return <p>Error loading data: {error}<br />Try refreshing in a couple seconds.</p>;
  if (!data) return <p>No data available.</p>;

  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
      <h1>Server Status Dashboard</h1>
      {data.servers.map((d) => {
        const { id, results } = d;
        const latest = results[results.length - 1];
        return (
          <div key={id} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}>
            <h2>{latest.serverName || 'Not Available'}</h2>
            <p><strong>Address:</strong> {latest.serverAddress || "N/A"}</p>
            <p><strong>Map:</strong> {latest.map}</p>
            <p><strong>Players:</strong> {latest.onlinePlayers} / {latest.maxPlayers}</p>
            <p><strong>Status:</strong> {getStatus(results)}</p>
            {getButtons(latest.serverAddress, latest.sdr, data.redirectIP)}
          </div>
        );
      })}
      {tutorial()}
      {externalLinks(data.externalLinks)}
    </div>
  );
};

export default ServerStatusPage;
