"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import {
  PRESETS,
  QR_TYPES,
  applyCampaign,
  parseConfig,
  renderSvg,
  verify,
  type Config,
  type PresetName,
  type QrType,
} from "@/core";
import { browserRasterizer, fileToDataUri } from "../lib/browserRaster";
import { vcardFile } from "../lib/vcf";
import { canDownload, importTooLarge, vcardImportNotice } from "../lib/rules";
import { CAMPAIGN_PRESETS, TYPE_META, contentToForm, emptyValues, formToContent, type Field, type Values } from "../lib/forms";

type StyleState = {
  dotColor: string;
  cornerColor: string;
  backgroundColor: string;
  dotShape: "square" | "rounded" | "dot";
  cornerStyle: "square" | "rounded" | "circle";
  quietZone: number;
  errorCorrection: "L" | "M" | "Q" | "H";
  size: number;
};

type ImageState = { mode: "none" | "logo" | "blend"; src?: string; scale: number; veil: number };

type Status =
  | { state: "invalid"; errors: string[] }
  | { state: "checking" }
  | { state: "scans" }
  | { state: "wont"; message: string };

const START_STYLE: StyleState = { ...stylePreset("classic"), size: 1024 };

function stylePreset(name: PresetName): Omit<StyleState, "size"> {
  const { label: _l, ...p } = PRESETS[name];
  return { ...p };
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Page content that belongs to a site around the generator. Every slot is optional and empty by default, so the generator
 * stands alone; a site passes its own text and links in here.
 */
export type GeneratorSlots = {
  heroActions?: ReactNode;
  pitch?: ReactNode;
  /** Inside the tags block, after its intro line and before the one-click choices. */
  tagsCallout?: ReactNode;
  /** Inside the tags block, last, after the fields and the final address. */
  tagsFooter?: ReactNode;
  guide?: ReactNode;
  footerExtra?: ReactNode;
};

/**
 * Words a site may use in place of the generator's own, inside the tags block. Each is optional; anything left out keeps
 * the generator's default words.
 */
export type GeneratorWords = {
  /** The block's title. */
  tagsTitle?: string;
  /** The block's intro line. A string replaces it; `null` leaves it out (for a site that gives its own in `tagsCallout`). */
  tagsIntro?: string | null;
  /** The screen-reader name of the group of one-click choices. */
  presetsName?: string;
  /** Field labels in the tags block, by field key (utmSource, utmMedium, utmCampaign, utmContent). */
  fieldLabels?: Partial<Record<string, string>>;
};

const DEFAULT_WORDS = {
  tagsTitle: "Campaign tags (optional)",
  tagsIntro: "Tags let your own website analytics tell which printed piece brought each visit. See the guide below.",
  presetsName: "Campaign presets",
} as const;

export default function Generator({
  embedded = false,
  slots = {},
  words = {},
}: { embedded?: boolean; slots?: GeneratorSlots; words?: GeneratorWords } = {}) {
  const tagsIntro = words.tagsIntro === undefined ? DEFAULT_WORDS.tagsIntro : words.tagsIntro;
  const [type, setType] = useState<QrType>("link");
  const [valuesByType, setValuesByType] = useState<Record<QrType, Values>>(
    () => Object.fromEntries(QR_TYPES.map((t) => [t, emptyValues(t)])) as Record<QrType, Values>,
  );
  const [style, setStyle] = useState<StyleState>(START_STYLE);
  const [image, setImage] = useState<ImageState>({ mode: "none", scale: 0.22, veil: 0.3 });
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const values = valuesByType[type];

  // The config the form describes, before validation.
  const raw = useMemo(
    () => ({
      version: 1,
      type,
      content: formToContent(type, values),
      style,
      image: image.mode === "none" ? { mode: "none" } : image,
      output: { format: "png" },
    }),
    [type, values, style, image],
  );
  const rawKey = useMemo(() => JSON.stringify(raw), [raw]);
  const parsed = useMemo(() => parseConfig(JSON.parse(rawKey)), [rawKey]);
  const config: Config | null = parsed.ok ? parsed.config : null;
  const finalUrl = useMemo(() => {
    if (!config || config.type !== "link" || !config.content.campaign) return null;
    return applyCampaign(config.content.url, config.content.campaign);
  }, [config]);

  useEffect(() => {
    const id = ++runId.current;
    if (!parsed.ok) {
      setSvg(null);
      setStatus({ state: "invalid", errors: parsed.errors });
      return;
    }
    setStatus({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const out = renderSvg(parsed.config);
        const result = await verify(parsed.config, browserRasterizer);
        if (id !== runId.current) return;
        setSvg(out);
        setStatus(result.ok ? { state: "scans" } : { state: "wont", message: result.message });
      } catch (e) {
        if (id !== runId.current) return;
        const msg = e instanceof Error ? e.message : "Could not make this code.";
        setSvg(null);
        setStatus({
          state: "invalid",
          errors: [/too big|too long|amount of data/i.test(msg) ? "There is too much content for one QR code. Shorten it a little." : msg],
        });
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [parsed]);

  const setValue = (key: string, v: string | boolean) =>
    setValuesByType((all) => ({ ...all, [type]: { ...all[type], [key]: v } }));
  const setStyleField = <K extends keyof StyleState>(k: K, v: StyleState[K]) => setStyle((s) => ({ ...s, [k]: v }));

  const activePreset = (Object.keys(PRESETS) as PresetName[]).find((n) => {
    const p = stylePreset(n);
    return (Object.keys(p) as (keyof typeof p)[]).every((k) => p[k] === style[k]);
  });

  async function onImageFile(file: File | undefined) {
    if (!file) return;
    setNotice("");
    try {
      const blend = image.mode === "blend";
      const src = await fileToDataUri(file, blend ? 1000 : 256, blend ? "jpeg" : "png");
      setImage((i) => ({ ...i, src }));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not read that image.");
    }
  }

  async function download(kind: "png" | "svg") {
    if (!config || !svg) return;
    setBusy(true);
    try {
      const name = `bandit-codes-${type}`;
      if (kind === "svg") downloadBlob(new Blob([renderSvg(config)], { type: "image/svg+xml" }), `${name}.svg`);
      else {
        const png = await browserRasterizer.toPng(renderSvg(config), config.style.size);
        downloadBlob(new Blob([png as BlobPart], { type: "image/png" }), `${name}.png`);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The download did not work.");
    } finally {
      setBusy(false);
    }
  }

  function downloadContact() {
    const f = config ? vcardFile(config) : null;
    if (f) downloadBlob(new Blob([f.text], { type: f.mime }), f.name);
  }

  function exportJson() {
    if (!config) return;
    const { $schema: _s, ...rest } = config;
    downloadBlob(new Blob([JSON.stringify(rest, null, 2) + "\n"], { type: "application/json" }), "bandit-codes-config.json");
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    setNotice("");
    try {
      if (importTooLarge(file.size)) {
        setNotice("That settings file is too large to be a Bandit Codes config.");
        return;
      }
      const res = parseConfig(JSON.parse(await file.text()));
      if (!res.ok) {
        setNotice(`That file is not a Bandit Codes config. ${res.errors.slice(0, 3).join(" ")}`);
        return;
      }
      const c = res.config;
      const warn = vcardImportNotice(c);
      if (warn) setNotice(warn);
      setType(c.type);
      setValuesByType((all) => ({ ...all, [c.type]: contentToForm(c.type, c.content as Record<string, unknown>) }));
      setStyle({
        dotColor: c.style.dotColor,
        cornerColor: c.style.cornerColor ?? c.style.dotColor,
        backgroundColor: c.style.backgroundColor,
        dotShape: c.style.dotShape,
        cornerStyle: c.style.cornerStyle,
        quietZone: c.style.quietZone,
        errorCorrection: c.style.errorCorrection,
        size: c.style.size,
      });
      setImage({ mode: c.image.mode, src: c.image.src, scale: c.image.scale, veil: c.image.veil });
    } catch {
      setNotice("That file could not be read as JSON.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  const svgUrl = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  const meta = TYPE_META[type];

  return (
    <>
      {!embedded && (
      <header className="top">
        <div className="wrap top-inner">
          <div className="hero-text">
            <div className="top-bar-row">
              <p className="brand">
                <Logo size={30} />
                <span className="brand-name">
                  Bandit <span>Codes</span>
                </span>
              </p>
              <ThemeToggle />
            </div>
            <h1>Free QR codes. Made on your device.</h1>
            <p className="lead">
              Pick what the code should do, choose a look, and download it. No account, no limits, no subscription.
            </p>
          </div>
          {slots.heroActions}
        </div>
      </header>
      )}

      <Main embedded={embedded}>
        {!embedded && slots.pitch}
        <div className="layout">
          <section className="card area-type" aria-labelledby="h-type">
            <h2 id="h-type">
              <span className="step">1</span> What should the code do?
            </h2>
            <div className="types" role="radiogroup" aria-label="Type of QR code">
              {QR_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === type}
                  className={`type-btn${t === type ? " on" : ""}`}
                  onClick={() => setType(t)}
                >
                  <span className="type-name">{TYPE_META[t].label}</span>
                  <span className="type-blurb">{TYPE_META[t].blurb}</span>
                </button>
              ))}
            </div>
            <div className="fields">
              {meta.fields
                .filter((f) => f.group !== "campaign")
                .filter((f) => !f.showIf || f.showIf(values))
                .map((f) => (
                  <FieldInput key={`${type}-${f.key}`} field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} />
                ))}
            </div>
            {type === "link" && (
              <details className="campaign">
                <summary>{words.tagsTitle ?? DEFAULT_WORDS.tagsTitle}</summary>
                {tagsIntro && <p className="fine">{tagsIntro}</p>}
                {slots.tagsCallout}
                <div className="chips" role="group" aria-label={words.presetsName ?? DEFAULT_WORDS.presetsName}>
                  {CAMPAIGN_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="chip"
                      onClick={() =>
                        setValuesByType((all) => ({ ...all, link: { ...all.link, utmSource: p.source, utmMedium: p.medium } }))
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="fields">
                  {meta.fields
                    .filter((f) => f.group === "campaign")
                    .map((f) => {
                      const label = words.fieldLabels?.[f.key];
                      const shown = label ? { ...f, label } : f;
                      return (
                        <FieldInput key={`${type}-${f.key}`} field={shown} value={values[f.key]} onChange={(v) => setValue(f.key, v)} />
                      );
                    })}
                </div>
                {finalUrl && (
                  <p className="final-url">
                    <strong>Address in your code:</strong> <span className="mono">{finalUrl.url}</span>
                    {finalUrl.kept.length > 0 && (
                      <span className="fine"> Your address already had {finalUrl.kept.join(", ")}, so we left those as they were.</span>
                    )}
                  </p>
                )}
                {slots.tagsFooter}
              </details>
            )}
          </section>

          <section className="card area-preview" aria-labelledby="h-preview">
            <h2 id="h-preview">
              <span className="step">4</span> Check and download
            </h2>
            <div className="preview-box">
              {svgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={svgUrl} alt="Preview of your QR code" className="qr" />
              ) : (
                <p className="empty">
                  {status.state === "invalid" ? "Fill in the form to see your code." : "Drawing your code…"}
                </p>
              )}
            </div>
            <div role="status" aria-live="polite" className={`badge ${status.state}`}>
              {status.state === "scans" && (
                <>
                  <b>Scans.</b> We read it back here and got your content.
                </>
              )}
              {status.state === "checking" && <>Checking that it scans…</>}
              {status.state === "wont" && (
                <>
                  <b>Won&apos;t scan.</b> {status.message}
                </>
              )}
              {status.state === "invalid" && (
                <>
                  <b>Almost there.</b> {status.errors[0]}
                </>
              )}
            </div>
            {status.state === "invalid" && status.errors.length > 1 && (
              <ul className="errors">
                {status.errors.slice(1, 4).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="btn primary" disabled={!canDownload(svg, busy, status.state)} onClick={() => download("png")}>
                Download PNG{status.state === "wont" ? " anyway" : ""}
              </button>
              <button className="btn" disabled={!canDownload(svg, busy, status.state)} onClick={() => download("svg")}>
                Download SVG
              </button>
              {type === "vcard" && (
                <button className="btn" disabled={!config} onClick={downloadContact}>
                  Download contact file (.vcf)
                </button>
              )}
            </div>
            <div className="actions small">
              <button className="btn link" disabled={!config} onClick={exportJson}>
                Save settings (JSON)
              </button>
              <label className="btn link">
                Load settings
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => importJson(e.target.files?.[0])}
                />
              </label>
            </div>
            {notice && (
              <p className="notice" role="alert">
                {notice}
              </p>
            )}
            <p className="fine">
              The check reads your code the way a phone camera app would, at a few sizes. It is a strong sign that the
              code will scan, and phones differ. Test a printed code with your own phone before you print a lot of them.
            </p>
          </section>

          <section className="card area-design" aria-labelledby="h-design">
            <h2 id="h-design">
              <span className="step">2</span> Choose a look
            </h2>
            <div className="presets" role="group" aria-label="Style presets">
              {(Object.keys(PRESETS) as PresetName[]).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`preset${activePreset === n ? " on" : ""}`}
                  aria-pressed={activePreset === n}
                  onClick={() => setStyle((s) => ({ ...s, ...stylePreset(n) }))}
                >
                  <span
                    className="swatch"
                    style={{ background: PRESETS[n].backgroundColor, borderColor: PRESETS[n].dotColor }}
                    aria-hidden
                  >
                    <i style={{ background: PRESETS[n].dotColor }} />
                    <i style={{ background: PRESETS[n].cornerColor }} />
                  </span>
                  {PRESETS[n].label}
                </button>
              ))}
            </div>

            <div className="grid2">
              <ColorField id="c-dot" label="Dot color" value={style.dotColor} onChange={(v) => setStyleField("dotColor", v)} />
              <ColorField id="c-corner" label="Corner color" value={style.cornerColor} onChange={(v) => setStyleField("cornerColor", v)} />
              <ColorField id="c-bg" label="Background" value={style.backgroundColor} onChange={(v) => setStyleField("backgroundColor", v)} />
            </div>

            <Segmented
              legend="Dot shape"
              value={style.dotShape}
              onChange={(v) => setStyleField("dotShape", v)}
              options={[
                { value: "square", label: "Square" },
                { value: "rounded", label: "Rounded" },
                { value: "dot", label: "Dots" },
              ]}
            />
            <Segmented
              legend="Corner style"
              value={style.cornerStyle}
              onChange={(v) => setStyleField("cornerStyle", v)}
              options={[
                { value: "square", label: "Square" },
                { value: "rounded", label: "Rounded" },
                { value: "circle", label: "Circle" },
              ]}
            />

            <div className="grid2">
              <div className="field">
                <label htmlFor="quiet">Quiet zone: {style.quietZone} modules</label>
                <input
                  id="quiet"
                  type="range"
                  min={0}
                  max={16}
                  value={style.quietZone}
                  onChange={(e) => setStyleField("quietZone", Number(e.target.value))}
                />
                <span className="help">The empty margin. Four is the standard.</span>
              </div>
              <div className="field">
                <label htmlFor="ecc">Error correction</label>
                <select
                  id="ecc"
                  value={style.errorCorrection}
                  onChange={(e) => setStyleField("errorCorrection", e.target.value as StyleState["errorCorrection"])}
                >
                  <option value="L">Low (7%): smallest code</option>
                  <option value="M">Medium (15%)</option>
                  <option value="Q">Quartile (25%)</option>
                  <option value="H">High (30%): survives wear</option>
                </select>
                <span className="help">
                  {image.mode === "blend"
                    ? "Image mode uses High."
                    : image.mode === "logo"
                      ? "A logo needs at least Quartile, so it is raised if needed."
                      : "More correction means a denser code."}
                </span>
              </div>
              <div className="field">
                <label htmlFor="size">Download size</label>
                <select id="size" value={style.size} onChange={(e) => setStyleField("size", Number(e.target.value))}>
                  {[...new Set([256, 512, 1024, 2048, 4096, style.size])].sort((a, b) => a - b).map((s) => (
                    <option key={s} value={s}>
                      {s} × {s} px
                    </option>
                  ))}
                </select>
                <span className="help">PNG only. SVG scales to any size.</span>
              </div>
            </div>
          </section>

          <section className="card area-image" aria-labelledby="h-image">
            <h2 id="h-image">
              <span className="step">3</span> Add a picture <span className="opt">optional</span>
            </h2>
            <Segmented
              legend="Picture"
              value={image.mode}
              onChange={(v) => setImage((i) => ({ ...i, mode: v, src: v === i.mode ? i.src : undefined }))}
              options={[
                { value: "none", label: "None" },
                { value: "logo", label: "Logo in the center" },
                { value: "blend", label: "Photo behind the code" },
              ]}
            />
            {image.mode !== "none" && (
              <div className="fields">
                <div className="field">
                  <label htmlFor="img">{image.mode === "logo" ? "Logo image" : "Photo"}</label>
                  <input
                    id="img"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => onImageFile(e.target.files?.[0])}
                  />
                  <span className="help">
                    The picture is resized and used right here. It is never uploaded.
                    {image.src ? " Picture loaded." : ""}
                  </span>
                </div>
                {image.mode === "logo" ? (
                  <div className="field">
                    <label htmlFor="scale">Logo size: {Math.round(image.scale * 100)}% of the code</label>
                    <input
                      id="scale"
                      type="range"
                      min={10}
                      max={30}
                      value={Math.round(image.scale * 100)}
                      onChange={(e) => setImage((i) => ({ ...i, scale: Number(e.target.value) / 100 }))}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="veil">Lighten the photo: {Math.round(image.veil * 100)}%</label>
                    <input
                      id="veil"
                      type="range"
                      min={0}
                      max={90}
                      value={Math.round(image.veil * 100)}
                      onChange={(e) => setImage((i) => ({ ...i, veil: Number(e.target.value) / 100 }))}
                    />
                    <span className="help">
                      Light, even photos work best. A lighter wash and darker dots help it scan. The scan check tells
                      you when it still will not read.
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
        <p className="privacy" id="privacy">
          <strong>Nothing leaves your device.</strong> Your text, contact details, photos and settings stay in this
          browser tab. The code is drawn and checked here, with no uploads, no accounts, no analytics and no tracking.
        </p>
        {!embedded && slots.guide}
      </Main>

      {!embedded && (
      <footer className="foot">
        <div className="wrap">
          <p>
            Bandit Codes is free and open source under the MIT license.
            {slots.footerExtra}
          </p>
        </div>
      </footer>
      )}
    </>
  );
}

function Main({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return embedded ? <div className="wrap">{children}</div> : <main className="wrap">{children}</main>;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const id = `f-${field.key}`;
  if (field.kind === "checkbox") {
    return (
      <div className="field check">
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id}>{field.label}</label>
      </div>
    );
  }
  const v = typeof value === "string" ? value : "";
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      {field.kind === "textarea" ? (
        <textarea id={id} rows={3} value={v} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "select" ? (
        <select id={id} value={v} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={
            field.kind === "datetime" ? "datetime-local" : field.kind === "date" ? "date" : field.kind === "text" ? "text" : field.kind
          }
          inputMode={field.key === "latitude" || field.key === "longitude" ? "decimal" : undefined}
          value={v}
          placeholder={field.placeholder}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && <span className="help">{field.help}</span>}
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field color">
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <code>{value}</code>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset className="seg">
      <legend>{legend}</legend>
      <div className="seg-row">
        {options.map((o) => (
          <label key={o.value} className={`seg-opt${o.value === value ? " on" : ""}`}>
            <input type="radio" name={legend} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
