import {
  ArrowUpRight,
  ArrowRight,
  FileText,
  Layers3,
  ScanLine,
  CheckCheck,
  MessageSquareText,
  Download,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "@/components/brand";
export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <a href="/" aria-label="BuildERP home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="#workflow">How it works</a>
          <a href="#features">The workspace</a>
        </div>
        <a className="button dark" href="/workspace">
          Open workspace <ArrowUpRight size={17} />
        </a>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> BUILT FOR THE DETAILS
          </div>
          <h1>
            From specifications.
            <br />
            To <em>clear next steps.</em>
          </h1>
          <p>
            Your documents, requirements, and submittals in one considered
            workspace. Find the source. Review the detail. Move the project
            forward.
          </p>
          <div className="hero-actions">
            <a className="button orange" href="/workspace?signup=1">
              Create your workspace <ArrowRight size={18} />
            </a>
            <a className="text-link" href="#workflow">
              See how it works <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="hero-note">
            <ShieldCheck size={16} /> Private projects. Source-backed decisions.
          </div>
        </div>
        <div className="hero-label">
          SPECIFICATION INTELLIGENCE
          <br />
          <b>Build with clarity.</b>
        </div>
      </section>
      <section
        className="preview-wrap"
        aria-label="Example submittal workspace"
      >
        <div className="product-preview">
          <aside>
            <Brand compact />
            <div className="preview-menu active">
              <Layers3 size={16} /> Projects
            </div>
            <div className="preview-menu">
              <FileText size={16} /> Specifications
            </div>
            <div className="preview-menu">
              <CheckCheck size={16} /> Submittal register
            </div>
            <div className="preview-menu">
              <MessageSquareText size={16} /> Document chat
            </div>
            <div className="preview-bottom">ONE SOURCE OF TRUTH</div>
          </aside>
          <div className="preview-main">
            <div className="preview-top">
              Projects <span>/</span> Northpoint Office{" "}
              <span className="sample-label">Illustrative workspace</span>
            </div>
            <div className="preview-heading">
              <div>
                <small>PROJECT WORKSPACE</small>
                <h2>Every requirement. Accounted for.</h2>
              </div>
              <span className="outline-label">Section 23 31 13</span>
            </div>
            <div className="preview-stats">
              <div>
                <FileText />
                <b>Specifications</b>
                <small>Original documents, always in reach</small>
              </div>
              <div>
                <ScanLine />
                <b>Traceable evidence</b>
                <small>Return directly to the source</small>
              </div>
              <div>
                <CheckCheck />
                <b>Reviewed by you</b>
                <small>Keep control of the final register</small>
              </div>
            </div>
            <div className="preview-table">
              <div className="preview-tr">
                <b>SUBMITTAL</b>
                <b>SOURCE</b>
                <b>REVIEW</b>
              </div>
              <div className="preview-tr">
                <span>
                  <FileText size={16} /> Manufacturer’s product data
                </span>
                <span>§ 1.04.A.2</span>
                <span className="badge approved">Approved</span>
              </div>
              <div className="preview-tr">
                <span>
                  <FileText size={16} /> Ductwork shop drawings
                </span>
                <span>§ 1.04.B</span>
                <span className="badge review">Needs review</span>
              </div>
              <div className="preview-tr">
                <span>
                  <FileText size={16} /> Installation certificates
                </span>
                <span>§ 1.04.C</span>
                <span className="badge draft">Draft</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="intro-strip">
        <span>
          LESS SEARCHING.
          <br />
          <b>MORE CERTAINTY.</b>
        </span>
        <p>
          A specification should answer questions.
          <br />
          Your workspace should help you find those answers.
        </p>
      </section>
      <section className="features-section" id="features">
        <div className="section-heading">
          <div className="eyebrow">THE WORKSPACE</div>
          <h2>
            Keep the detail.
            <br />
            Lose the document shuffle.
          </h2>
        </div>
        <div className="feature-grid">
          {[
            [
              ScanLine,
              "Follow every requirement to its source",
              "Review extracted text beside the original PDF, with evidence highlighted on the page.",
            ],
            [
              MessageSquareText,
              "Ask the documents",
              "Find answers across your project specifications, with citations you can open and verify.",
            ],
            [
              Download,
              "Turn review into a register",
              "Edit requirements, resolve warnings, and export your work to Excel, Markdown, or structured JSON.",
            ],
          ].map(([Icon, title, desc]) => {
            const I = Icon as typeof ScanLine;
            return (
              <article key={String(title)}>
                <I size={27} />
                <h3>{String(title)}</h3>
                <p>{String(desc)}</p>
              </article>
            );
          })}
        </div>
      </section>
      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <div className="eyebrow">A CONNECTED WORKFLOW</div>
          <h2>From upload to approved.</h2>
        </div>
        <div className="steps">
          {[
            [
              "01",
              "Bring your specifications",
              "Create a project and upload PDFs. Previously processed files reuse their extraction.",
            ],
            [
              "02",
              "Find what needs to be submitted",
              "Extract requirements and products with references to the source document.",
            ],
            [
              "03",
              "Review, then move forward",
              "Check evidence, make edits, approve your requirements, and download the register.",
            ],
          ].map(([n, t, d]) => (
            <article key={n}>
              <span>{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="final-cta">
        <div>
          <div className="eyebrow">YOUR NEXT PROJECT STARTS HERE</div>
          <h2>Bring clarity to the build.</h2>
        </div>
        <a className="button orange" href="/workspace?signup=1">
          Get started <ArrowRight size={18} />
        </a>
      </section>
      <footer>
        <Brand />
        <span>Specifications · Submittals · Source evidence</span>
        <a href="/workspace">
          Sign in <ArrowUpRight size={15} />
        </a>
      </footer>
    </main>
  );
}
