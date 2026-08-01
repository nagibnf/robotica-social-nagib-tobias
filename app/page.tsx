"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RobotActivityFeed } from "./robot-activity-feed";
import { formatTelemetryValue, type RobotTelemetry } from "./prs-live";
import { usePrsLive } from "./use-prs-live";

const ACTS = 8;
const SLIDE_TRANSITION_MS = 840;

const fieldModes = [
  { energy: 0.34, cameraY: 5.1, cameraZ: 10.8, fieldZ: 0.0 },
  { energy: 0.2, cameraY: 4.7, cameraZ: 12.4, fieldZ: -0.8 },
  { energy: 0.52, cameraY: 5.5, cameraZ: 9.8, fieldZ: 0.5 },
  { energy: 0.29, cameraY: 4.9, cameraZ: 11.5, fieldZ: -0.4 },
  { energy: 0.16, cameraY: 4.4, cameraZ: 13.0, fieldZ: -1.1 },
  { energy: 0.4, cameraY: 5.3, cameraZ: 10.2, fieldZ: 0.35 },
  { energy: 0.24, cameraY: 4.8, cameraZ: 11.9, fieldZ: -0.55 },
  { energy: 0.48, cameraY: 5.6, cameraZ: 9.5, fieldZ: 0.7 },
];

type DeckApi = {
  initialize: () => Promise<unknown>;
  destroy: () => void;
  next: () => void;
  prev: () => void;
  on: (
    event: string,
    handler: (event: {
      indexh: number;
      previousSlide?: HTMLElement;
    }) => void,
  ) => void;
};

function Field({ act }: { act: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const targetMode = useRef(fieldModes[0]);
  const transitionPulse = useRef(0);

  useEffect(() => {
    targetMode.current = fieldModes[act] ?? fieldModes[0];
    transitionPulse.current = 1;
  }, [act]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    // Fog color matches --ink so fogged lines blend into the page background.
    scene.fog = new THREE.Fog(0x080a08, 16, 40);
    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 5.1, 10.8);
    camera.lookAt(0, -0.8, -2.2);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Oversized plane + radial shader fade so the dot field dissolves before
    // its geometric edges ever enter the frame.
    const columns = 176;
    const rows = 112;
    const positions = new Float32Array(columns * rows * 3);
    let pointer = 0;
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < columns; x += 1) {
        positions[pointer++] = (x / (columns - 1) - 0.5) * 64;
        positions[pointer++] = 0;
        positions[pointer++] = (z / (rows - 1) - 0.5) * 64 - 2;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: targetMode.current.energy },
      uPhase: { value: 0 },
      uColor: { value: new THREE.Color("#88e888") },
    };

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uPhase;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float primary = sin(p.x * 0.48 + uTime * 0.32 + uPhase) * cos(p.z * 0.34 - uTime * 0.21);
          float secondary = sin(length(p.xz) * 0.52 - uTime * 0.28 + uPhase * 0.5);
          p.y += (primary * 0.72 + secondary * 0.28) * uEnergy;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (1.7 + uEnergy * 2.2) * (180.0 / -mvPosition.z);
          float horizon = 1.0 - smoothstep(13.0, 29.0, length(p.xz - vec2(0.0, -2.0)));
          vAlpha = (0.18 + smoothstep(-26.0, 7.0, p.z) * 0.55) * horizon;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          float alpha = smoothstep(0.5, 0.14, d) * vAlpha;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    const points = new THREE.Points(geometry, material);
    points.rotation.x = -0.1;
    scene.add(points);

    const grid = new THREE.GridHelper(64, 96, 0x88e888, 0x263226);
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    gridMaterial.depthWrite = false;
    grid.position.set(0, -0.28, -2);
    scene.add(grid);

    const gateGroup = new THREE.Group();
    const gates: THREE.LineLoop[] = [];
    for (let index = 0; index < 4; index += 1) {
      const width = 5.8 + index * 1.25;
      const height = 3.2 + index * 0.72;
      const gateGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width, -height, 0),
        new THREE.Vector3(width, -height, 0),
        new THREE.Vector3(width, height, 0),
        new THREE.Vector3(-width, height, 0),
      ]);
      const gateMaterial = new THREE.LineBasicMaterial({
        color: 0x88e888,
        transparent: true,
        opacity: 0.055 + index * 0.012,
        depthWrite: false,
        fog: false,
      });
      const gate = new THREE.LineLoop(gateGeometry, gateMaterial);
      gate.position.z = -2.5 - index * 3.2;
      gate.userData.baseZ = gate.position.z;
      gates.push(gate);
      gateGroup.add(gate);
    }
    gateGroup.position.set(2.8, 1.25, -1);
    gateGroup.rotation.x = -0.06;
    scene.add(gateGroup);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let time = 0;
    let currentEnergy = targetMode.current.energy;
    let currentFieldZ = targetMode.current.fieldZ;
    let pointerX = 0;
    let pointerY = 0;

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 0.32;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 0.18;
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const animate = () => {
      time += reducedMotion ? 0 : 0.016;
      const mode = targetMode.current;
      const pulse = transitionPulse.current;
      currentEnergy += (mode.energy + pulse * 0.28 - currentEnergy) * 0.055;
      currentFieldZ += (mode.fieldZ - currentFieldZ) * 0.032;
      transitionPulse.current = reducedMotion ? 0 : Math.max(0, pulse * 0.94 - 0.004);
      uniforms.uTime.value = time;
      uniforms.uEnergy.value = currentEnergy;
      uniforms.uPhase.value += reducedMotion ? 0 : 0.0015 + pulse * 0.016;
      points.position.z = currentFieldZ;
      points.rotation.z += (pointerX - points.rotation.z) * 0.012;
      grid.position.z = -2 + currentFieldZ;
      gridMaterial.opacity = 0.055 + currentEnergy * 0.11 + pulse * 0.05;
      gates.forEach((gate, index) => {
        const baseZ = gate.userData.baseZ as number;
        gate.position.z += (baseZ + pulse * (4.5 + index * 0.55) - gate.position.z) * 0.08;
        (gate.material as THREE.LineBasicMaterial).opacity = 0.035 + index * 0.012 + pulse * 0.11;
      });
      gateGroup.rotation.z += (pointerX * 0.18 - gateGroup.rotation.z) * 0.012;
      camera.position.x += (pointerX * 2.2 - camera.position.x) * 0.018;
      camera.position.y += (mode.cameraY - pointerY * 1.5 - camera.position.y) * 0.025;
      camera.position.z += (mode.cameraZ - camera.position.z) * 0.025;
      camera.lookAt(0, -0.8, -2.2);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize);
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      gates.forEach((gate) => {
        gate.geometry.dispose();
        (gate.material as THREE.Material).dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="field" aria-hidden="true" />;
}

function TelemetryBar({ data }: { data: RobotTelemetry }) {
  const stale = data.stale ? " telemetry--stale" : "";
  return (
    <div className={`telemetry${stale}`} aria-label="Telemetria do Tobias">
      <span><b>BATERIA</b> {formatTelemetryValue(data.batteryPct)}%</span>
      <span><b>CPU</b> {formatTelemetryValue(data.cpuPct)}%</span>
      <span><b>TEMP</b> {formatTelemetryValue(data.tempC, 1)}°C</span>
      <span><b>RAM</b> {formatTelemetryValue(data.ramPct)}%</span>
    </div>
  );
}

function DeckSlide({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="act-frame">{children}</div>
    </section>
  );
}

export default function Home() {
  const revealRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<DeckApi | null>(null);
  const [act, setAct] = useState(0);
  const [contingency, setContingency] = useState(false);
  const [transitionEpoch, setTransitionEpoch] = useState(0);
  const prs = usePrsLive();

  useEffect(() => {
    let cancelled = false;
    const exitTimers = new Set<number>();

    async function startDeck() {
      if (!revealRef.current || deckRef.current) return;
      const revealModule = await import("reveal.js");
      if (cancelled || !revealRef.current) return;
      const Reveal = revealModule.default;
      const deck = new Reveal(revealRef.current, {
        width: 1440,
        height: 810,
        margin: 0,
        minScale: 0.2,
        maxScale: 2,
        controls: false,
        progress: false,
        center: false,
        hash: true,
        history: true,
        transition: "fade",
        backgroundTransition: "fade",
        touch: true,
        keyboard: true,
        overview: false,
        help: false,
      }) as DeckApi;
      deck.on("slidechanged", ({ indexh, previousSlide }) => {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (previousSlide && !reducedMotion) {
          // Reveal marks the old slide hidden immediately. Keep it paintable
          // until its CSS exit finishes, then restore the inactive state.
          previousSlide.classList.add("is-exiting");
          previousSlide.hidden = false;
          previousSlide.removeAttribute("aria-hidden");
          const timer = window.setTimeout(() => {
            exitTimers.delete(timer);
            previousSlide.classList.remove("is-exiting");
            if (!previousSlide.classList.contains("present")) {
              previousSlide.hidden = true;
              previousSlide.setAttribute("aria-hidden", "true");
            }
          }, SLIDE_TRANSITION_MS);
          exitTimers.add(timer);
        }
        setAct(indexh);
        setTransitionEpoch((value) => value + 1);
      });
      await deck.initialize();
      deckRef.current = deck;
    }

    startDeck();
    return () => {
      cancelled = true;
      exitTimers.forEach((timer) => window.clearTimeout(timer));
      deckRef.current?.destroy();
      deckRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        setContingency((value) => !value);
      }
      if (event.key === "Escape" && contingency) {
        setContingency(false);
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!document.fullscreenElement) {
          void document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          void document.exitFullscreen?.().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contingency]);

  const navigateByClick = (event: React.PointerEvent<HTMLElement>) => {
    if (contingency || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a")) return;
    if (event.clientX < window.innerWidth * 0.16) deckRef.current?.prev();
    else deckRef.current?.next();
  };

  return (
    <main className="experience" onPointerUp={navigateByClick} aria-label="Apresentação Robótica Social">
      <Field act={act} />
      <RobotActivityFeed entries={prs.entries} />
      <div className="noise" aria-hidden="true" />
      <div key={transitionEpoch} className="wire-transition" aria-hidden="true">
        <span className="wire wire-vertical" />
      </div>

      <div ref={revealRef} className="reveal">
        <div className="slides">
          <DeckSlide className="act act-opening">
            <h1 className="impact impact-hero">ROBÓTICA<br />SOCIAL</h1>
            <p className="support support-accent">DO CORPO À PRESENÇA</p>
            <p className="micro micro-right">DOIS PARTICIPANTES.<br />UMA RELAÇÃO EM TEMPO REAL.</p>
          </DeckSlide>

          <DeckSlide className="act act-presence">
            <h2 className="impact impact-wide">CORPO <span>≠</span><br />PRESENÇA</h2>
            <p className="support support-bottom">ESTAR NO AMBIENTE <span>≠</span> PARTICIPAR DO AMBIENTE</p>
          </DeckSlide>

          <DeckSlide className="act act-architecture">
            <h2 className="impact impact-stack">PERCEBER.<br />ORQUESTRAR.<br /><span>EXPRESSAR.</span></h2>
            <div className="technical-strip" aria-label="Camadas do PRS">
              <p><b>PERCEPÇÃO</b><br />voz · visão · sensores · distância</p>
              <p><b>ORQUESTRAÇÃO</b><br />identidade · contexto · memória · segurança</p>
              <p><b>EXPRESSÃO</b><br />fala · olhar · gestos · postura · ações</p>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-state">
            <h2 className="impact impact-wide">PRESENÇA<br /><span>É ESTADO.</span></h2>
            <div className="state-readout" aria-label="Estado do Tobias">
              <p><b>INTERLOCUTOR</b><span>NAGIB</span></p>
              <p><b>INTENÇÃO</b><span>EXPLICAR</span></p>
              <p><b>MEMÓRIA</b><span>ESTA SESSÃO</span></p>
              <p><b>FALA</b><span>25 SEGUNDOS</span></p>
              <p><b>SEGURANÇA</b><span>NORMAL</span></p>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-question">
            <h2 className="impact impact-question">QUANDO COMEÇAMOS<br />A TRATAR UMA MÁQUINA<br /><span>COMO ALGUÉM?</span></h2>
          </DeckSlide>

          <DeckSlide className="act act-value">
            <h2 className="impact impact-wide">ATENÇÃO<br />É FÁCIL.</h2>
            <p className="counter-impact">RELAÇÃO<br /><span>É DIFÍCIL.</span></p>
            <p className="micro micro-left">PRESENÇA ADICIONA VALOR<br />QUANDO CRIA CONTINUIDADE.</p>
          </DeckSlide>

          <DeckSlide className="act act-limits">
            <h2 className="impact impact-wide">TODA PRESENÇA<br /><span>PRECISA DE LIMITES.</span></h2>
            <div className="limit-strip" aria-label="Camadas de risco">
              <p>01 / FÍSICO</p>
              <p>02 / CONVERSACIONAL</p>
              <p>03 / RELACIONAL</p>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-closing">
            <p className="preclose">A PERGUNTA NÃO É SE A IA TERÁ UM CORPO.</p>
            <h2 className="impact impact-closing">QUE RELAÇÕES<br />VAMOS <span>PROJETAR?</span></h2>
            <div className="closing-meta">
              <p>PRS / PERSONAL ROBOT SYSTEM</p>
              <p>NAGIB × TOBIAS</p>
              <a href="https://www.bolha.com.br/produtos/tobias-robo" target="_blank" rel="noreferrer">BOLHA.COM.BR / TOBIAS</a>
            </div>
          </DeckSlide>
        </div>
      </div>

      <TelemetryBar data={prs.telemetry} />

      <div className="deck-chrome" aria-hidden="true">
        <span>{String(act + 1).padStart(2, "0")} / {String(ACTS).padStart(2, "0")}</span>
        <span>← VOLTAR · CLIQUE AVANÇAR · C CONTINGÊNCIA · F TELA CHEIA</span>
      </div>
      <div className="progress-rail" aria-hidden="true"><span style={{ width: `${((act + 1) / ACTS) * 100}%` }} /></div>

      <div className={`contingency ${contingency ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!contingency} aria-label="Tela de contingência">
        <p className="act-label">CONTINGÊNCIA / SISTEMA REAL</p>
        <h2>PRESENÇA TAMBÉM É<br />SABER LIDAR COM A<br /><span>IMPERFEIÇÃO.</span></h2>
        <p className="contingency-foot">PRESSIONE C OU ESC PARA VOLTAR</p>
      </div>
    </main>
  );
}
