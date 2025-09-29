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
  urlPath: string;
  results: ServerResult[];
};

type APIQuery = {
  externalLinks: ExternalLink[];
  servers: ServerData[];
  urlBase: string;
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

function getButtons(serverAddress: string, urlBase: string, urlPath: string, connectLinkDisabled: boolean, addressUnavailable: boolean): React.ReactNode {
  const connectCommand = serverAddress ? `connect ${serverAddress}` : "Server address not available.";
  const connectLink = `${urlBase}/tf2/${urlPath}`;

  return (
    <>
      <div style={{ display: "flex", gap: "1rem", justifyContent: 'center' }}>
        <div className="tooltip-wrapper">
          <button
            className={connectLinkDisabled ? "disabled" : ""}
            disabled={connectLinkDisabled}
            onClick={() => {
              window.open(`${connectLink}`, '_blank');
            }}
          >
            Connect to server
          </button>

          {<span className="tooltip">{connectLinkDisabled ? "You cannot connect to this server right now." : "Click to launch TF2 and connect directly to server."}</span>}
        </div>
        <div className="tooltip-wrapper">
          <button
            className={addressUnavailable ? "disabled" : ""}
            disabled={addressUnavailable}
            onClick={() => {
                navigator.clipboard.writeText(connectCommand)
            }}
          >
            Copy connect command
          </button>
          {<span className="tooltip">{addressUnavailable ? "Server address not available." : connectCommand}</span>}
        </div>
        <div className="tooltip-wrapper">
          <button
            onClick={() => {
              navigator.clipboard.writeText(connectLink)
            }}
          >
            Copy instant connect link
          </button>
          {<span className="tooltip">{connectLink}</span>}
        </div>
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
        const { urlPath, results } = d;
        
        const latest = results[results.length - 1];
        const latestValid = results.reduce((prev, curr) => {
          if (curr.maxPlayers > 0) {
            return curr;
          }
          return prev;
        });

        const connectLinkDisabled =
          !latestValid.serverAddress ||
          (latestValid.sdr && !data.redirectIP) ||
          latest.onlinePlayers == latest.maxPlayers ||
          latest.maxPlayers == 0;
        
        const addressUnavailable = !latestValid.serverAddress || (latestValid.sdr && latest.maxPlayers == 0);

        const serverAddress = addressUnavailable ? "Not available" : latestValid.serverAddress || "Not available";

        return (
          <div key={urlPath} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}>
            <h2>{latestValid.serverName || '<unknown server>'}</h2>
            <p><strong>Address:</strong> {serverAddress}</p>
            <p><strong>Map:</strong> {latest.map}</p>
            <p><strong>Players:</strong> {latest.onlinePlayers} / {latest.maxPlayers}</p>
            <p><strong>Status:</strong> {getStatus(results)}</p>
            {getButtons(latestValid.serverAddress, data.urlBase, urlPath, connectLinkDisabled, addressUnavailable)}
          </div>
        );
      })}
      {tutorial()}
      {externalLinks(data.externalLinks)}
    </div>
  );
};

export default ServerStatusPage;
