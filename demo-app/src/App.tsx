import { useState } from "react";

// BUG: missing alt on img (will affect every place Card is used)
const Card = ({ imageSrc, title }: { imageSrc: string; title: string }) => (
  <div style={{ border: "1px solid #ccc", padding: "16px", marginBottom: "16px" }}>
    <img src={imageSrc} />
    <h3>{title}</h3>
  </div>
);

// BUG: hidden by default (URL audit won't see any of these issues)
const Modal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{ background: "#fff", padding: "32px", borderRadius: "8px", width: "400px" }}>
        {/* BUG: 1: img used as close button — no alt, onClick on non-interactive element */}
        <img
          src="https://picsum.photos/seed/gutenberg-test/400/300"
          onClick={onClose}
          style={{ width: "24px", height: "24px", cursor: "pointer", float: "right" }}
        />

        <h2>Contact Us</h2>

        {/* BUG: 2: input with no label, only a placeholder */}
        <input
          type="text"
          placeholder="Your name"
          style={{ display: "block", width: "100%", marginBottom: "12px", padding: "8px" }}
        />

        {/* BUG: 3: input with no label, only a placeholder */}
        <input
          type="email"
          placeholder="Your email"
          style={{ display: "block", width: "100%", marginBottom: "12px", padding: "8px" }}
        />

        {/* BUG: 4: textarea with no label */}
        <textarea
          placeholder="Your message"
          style={{ display: "block", width: "100%", marginBottom: "12px", padding: "8px" }}
        />

        {/* BUG: 5: div used as button which is not keyboard accessible */}
        <div
          onClick={onClose}
          style={{
            background: "#b8422e", color: "#fff", padding: "10px 20px",
            cursor: "pointer", display: "inline-block", borderRadius: "4px",
          }}
        >
          Send Message
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div style={{ fontFamily: "Arial, sans-serif", maxWidth: "800px", margin: "0 auto", padding: "32px" }}>
      <h1>A11y Test Page</h1>
      <p>This page contains deliberate accessibility violations for testing ax-review vs URL audit tools.</p>

      {/* Section 1: Static Issues (both tools should catch these) */}
      <h2>Section 1: Static Issues</h2>

      {/* BUG: missing alt */}
      <img
        src="https://picsum.photos/seed/gutenberg-test/400/300"
        style={{ width: "200px", display: "block", marginBottom: "16px" }}
      />

      {/* BUG: generic link text */}
      <a href="/report">Click here</a>

      {/* BUG: ARIA label mismatch (Test 3) */}
      <button
        aria-label="Delete item"
        style={{ marginLeft: "16px", padding: "8px 16px" }}
      >
        Remove
      </button>

      {/* Section 2: Component Pattern (Test 2) */}
      <h2 style={{ marginTop: "32px" }}>Section 2: Component Pattern</h2>
      <p>Same Card component used 3 times. URL audit only catches issues on pages it scans.</p>

      <Card imageSrc="https://picsum.photos/seed/gutenberg-test/400/300" title="Card One" />
      <Card imageSrc="https://picsum.photos/seed/gutenberg-test/400/300" title="Card Two" />
      <Card imageSrc="https://picsum.photos/seed/gutenberg-test/400/300" title="Card Three" />

      {/* Section 3: Dynamic Content (Test 1) */}
      <h2 style={{ marginTop: "32px" }}>Section 3: Dynamic Content (Modal)</h2>
      <p>The modal below is hidden by default. URL audit will not see any issues inside it.</p>

      {/* BUG: div used as button to open modal */}
      <div
        onClick={() => setIsModalOpen(true)}
        style={{
          background: "#1A56A5", color: "#fff", padding: "10px 20px",
          cursor: "pointer", display: "inline-block", borderRadius: "4px",
        }}
      >
        Open Contact Modal
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
