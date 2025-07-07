export default function Tutorial() {
  return (
    <div key="tutorial" style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}>
      <h2>How to connect via console:</h2>
      <p style={{textAlign: "left"}}>1. Enable the developer console in Options &gt; Keyboard &amp; Advanced.<br/>
      2. Press the <strong>~</strong> key to open the console. <br/>
        3. Type <code style={{fontSize: 16, backgroundColor: "#101010", padding: "0.1rem"}}>connect [server address]</code> and press Enter.</p>
    </div>
  );
}