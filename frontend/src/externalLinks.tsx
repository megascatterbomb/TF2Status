export interface ExternalLink {
  title: string,
  description: string,
  url: string
}

export default function externalLinks(links: ExternalLink[]) {
  return links ? <>
    <div
      key="external-links"
      style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}
    >
      <h2>External links:</h2>
      {links.map((link, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem',
          }}
        >
          <button
            onClick={() => {
              window.open(link.url, '_blank');
            }}
          >
            {link.title}
          </button>
          <p
            style={{
              margin: 0,
              textAlign: 'left',
              maxWidth: '400px', // or any width you prefer
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'normal',
            }}
          >
            {link.description}
          </p>
        </div>
      ))}
    </div>


  </> : <></>
}