"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RobotActivityFeed } from "./robot-activity-feed";
import { formatTelemetryValue, type RobotTelemetry } from "./prs-live";
import { SlicedText } from "./sliced-text";
import { usePrsLive } from "./use-prs-live";

const ACTS = 8;
const SLIDE_TRANSITION_MS = 840;
const FIELD_JOURNEY_SECONDS = 60;

const fieldModes = [
  { energy: 0.34, cameraX: 0.0, cameraY: 5.1, cameraZ: 10.8, lookX: 0.0, lookY: -0.8, fieldX: 0.0, fieldZ: 0.0, yaw: 0.0, tilt: -0.01 },
  { energy: 0.2, cameraX: 2.1, cameraY: 4.3, cameraZ: 13.8, lookX: -1.0, lookY: -0.45, fieldX: -1.8, fieldZ: -1.6, yaw: 0.14, tilt: 0.055 },
  { energy: 0.52, cameraX: -1.8, cameraY: 5.7, cameraZ: 8.8, lookX: 0.9, lookY: -1.1, fieldX: 1.4, fieldZ: 1.2, yaw: -0.18, tilt: -0.06 },
  { energy: 0.29, cameraX: 2.6, cameraY: 6.8, cameraZ: 11.0, lookX: -1.2, lookY: -1.2, fieldX: -1.2, fieldZ: -0.6, yaw: 0.22, tilt: 0.08 },
  { energy: 0.16, cameraX: -2.4, cameraY: 3.9, cameraZ: 14.8, lookX: 1.3, lookY: -0.35, fieldX: 1.8, fieldZ: -2.0, yaw: -0.15, tilt: 0.07 },
  { energy: 0.4, cameraX: 1.0, cameraY: 4.1, cameraZ: 8.6, lookX: -0.6, lookY: -1.25, fieldX: -2.0, fieldZ: 1.5, yaw: 0.11, tilt: -0.09 },
  { energy: 0.24, cameraX: -1.4, cameraY: 6.6, cameraZ: 13.2, lookX: 0.8, lookY: -0.5, fieldX: 2.2, fieldZ: -1.0, yaw: -0.22, tilt: 0.06 },
  { energy: 0.48, cameraX: 2.3, cameraY: 5.9, cameraZ: 8.2, lookX: -1.1, lookY: -1.3, fieldX: -0.8, fieldZ: 1.8, yaw: 0.19, tilt: -0.04 },
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
      uTransition: { value: 0 },
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
        uniform float uTransition;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float primary = sin(p.x * 0.48 + uTime * 0.32 + uPhase) * cos(p.z * 0.34 - uTime * 0.21);
          float secondary = sin(length(p.xz) * 0.52 - uTime * 0.28 + uPhase * 0.5);
          float transitionWave = sin(p.z * 0.72 + p.x * 0.1 - uTime * 3.4 + uPhase * 1.7);
          float transitionEnvelope = 1.0 - smoothstep(7.0, 30.0, length(p.xz - vec2(0.0, -2.0)));
          p.y += (primary * 0.72 + secondary * 0.28) * uEnergy;
          p.y += transitionWave * transitionEnvelope * uTransition * 0.44;
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
    const clock = new THREE.Clock();
    let frame = 0;
    let time = 0;
    let currentEnergy = targetMode.current.energy;
    let currentCameraX = targetMode.current.cameraX;
    let currentCameraY = targetMode.current.cameraY;
    let currentCameraZ = targetMode.current.cameraZ;
    let currentFieldX = targetMode.current.fieldX;
    let currentFieldZ = targetMode.current.fieldZ;
    let currentYaw = targetMode.current.yaw;
    let currentTilt = targetMode.current.tilt;
    let currentLookX = targetMode.current.lookX;
    let currentLookY = targetMode.current.lookY;
    let journeyTarget = targetMode.current;
    let journeyElapsed = FIELD_JOURNEY_SECONDS;
    let journeyFrom = { ...journeyTarget };
    // Presentation clickers do not provide useful pointer movement. Keep the
    // composition biased as if the pointer rested at the viewport's right edge.
    const fieldBiasX = 0.16;

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.1);
      time += reducedMotion ? 0 : delta;
      const mode = targetMode.current;
      const pulse = transitionPulse.current;
      const activePulse = reducedMotion ? 0 : pulse;

      if (mode !== journeyTarget) {
        journeyFrom = {
          ...journeyTarget,
          cameraX: currentCameraX,
          cameraY: currentCameraY,
          cameraZ: currentCameraZ,
          lookX: currentLookX,
          lookY: currentLookY,
          fieldX: currentFieldX,
          fieldZ: currentFieldZ,
          yaw: currentYaw,
          tilt: currentTilt,
        };
        journeyTarget = mode;
        journeyElapsed = 0;
      }

      journeyElapsed = reducedMotion
        ? FIELD_JOURNEY_SECONDS
        : Math.min(FIELD_JOURNEY_SECONDS, journeyElapsed + delta);
      const journeyProgress = journeyElapsed / FIELD_JOURNEY_SECONDS;
      // Start the pan immediately enough to read against a repeating field,
      // then decelerate for the rest of the minute into a soft final position.
      const journeyEase = Math.sin((Math.PI * journeyProgress) / 2);
      currentCameraX = THREE.MathUtils.lerp(journeyFrom.cameraX, journeyTarget.cameraX, journeyEase);
      currentCameraY = THREE.MathUtils.lerp(journeyFrom.cameraY, journeyTarget.cameraY, journeyEase);
      currentCameraZ = THREE.MathUtils.lerp(journeyFrom.cameraZ, journeyTarget.cameraZ, journeyEase);
      currentFieldX = THREE.MathUtils.lerp(journeyFrom.fieldX, journeyTarget.fieldX, journeyEase);
      currentFieldZ = THREE.MathUtils.lerp(journeyFrom.fieldZ, journeyTarget.fieldZ, journeyEase);
      currentYaw = THREE.MathUtils.lerp(journeyFrom.yaw, journeyTarget.yaw, journeyEase);
      currentTilt = THREE.MathUtils.lerp(journeyFrom.tilt, journeyTarget.tilt, journeyEase);
      currentLookX = THREE.MathUtils.lerp(journeyFrom.lookX, journeyTarget.lookX, journeyEase);
      currentLookY = THREE.MathUtils.lerp(journeyFrom.lookY, journeyTarget.lookY, journeyEase);

      currentEnergy += (mode.energy + activePulse * 0.32 - currentEnergy) * 0.055;
      transitionPulse.current = reducedMotion ? 0 : Math.max(0, pulse * 0.94 - 0.004);
      uniforms.uTime.value = time;
      uniforms.uEnergy.value = currentEnergy;
      uniforms.uTransition.value = activePulse;
      uniforms.uPhase.value += reducedMotion ? 0 : 0.0015 + activePulse * 0.018;
      points.position.x = currentFieldX;
      points.position.z = currentFieldZ;
      points.rotation.y = currentYaw;
      points.rotation.z = fieldBiasX + currentTilt;
      grid.position.x = currentFieldX * 0.72;
      grid.position.z = -2 + currentFieldZ;
      grid.rotation.y = currentYaw;
      grid.rotation.z = currentTilt * 0.7;
      gridMaterial.opacity = 0.055 + currentEnergy * 0.11 + activePulse * 0.06;
      gates.forEach((gate, index) => {
        const baseZ = gate.userData.baseZ as number;
        gate.position.z += (baseZ + activePulse * (5.2 + index * 0.62) - gate.position.z) * 0.08;
        (gate.material as THREE.LineBasicMaterial).opacity = 0.035 + index * 0.012 + activePulse * 0.12;
      });
      gateGroup.position.x = 2.8 + currentFieldX * 0.28;
      gateGroup.rotation.y = currentYaw * 0.8;
      gateGroup.rotation.z = fieldBiasX * 0.18 + currentTilt * 0.6 + activePulse * 0.015;
      camera.position.x = currentCameraX + fieldBiasX * 2.2;
      camera.position.y = currentCameraY;
      camera.position.z = currentCameraZ;
      camera.lookAt(currentLookX, currentLookY, -2.2 + currentFieldZ * 0.18);
      camera.rotateZ(currentTilt * 0.35);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    window.addEventListener("resize", onResize);
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
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
            <SlicedText as="h1" className="impact impact-hero">ROBÓTICA<br />SOCIAL</SlicedText>
            <SlicedText as="p" className="support support-accent">DO CORPO À PRESENÇA</SlicedText>
            <SlicedText as="p" className="micro micro-right">DOIS PARTICIPANTES.<br />UMA RELAÇÃO EM TEMPO REAL.</SlicedText>
          </DeckSlide>

          <DeckSlide className="act act-presence">
            <SlicedText as="h2" className="impact impact-wide">CORPO <span className="text-accent">≠</span><br />PRESENÇA</SlicedText>
            <SlicedText as="p" className="support support-bottom">ESTAR NO AMBIENTE <span className="text-accent">≠</span> PARTICIPAR DO AMBIENTE</SlicedText>
          </DeckSlide>

          <DeckSlide className="act act-architecture">
            <SlicedText as="h2" className="impact impact-stack">PERCEBER.<br />ORQUESTRAR.<br /><span className="text-accent">EXPRESSAR.</span></SlicedText>
            <div className="technical-strip" aria-label="Camadas do PRS">
              <SlicedText as="p"><b>PERCEPÇÃO</b><br />voz · visão · sensores · distância</SlicedText>
              <SlicedText as="p"><b>ORQUESTRAÇÃO</b><br />identidade · contexto · memória · segurança</SlicedText>
              <SlicedText as="p"><b>EXPRESSÃO</b><br />fala · olhar · gestos · postura · ações</SlicedText>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-state">
            <SlicedText as="h2" className="impact impact-wide">PRESENÇA<br /><span className="text-accent">É ESTADO.</span></SlicedText>
            <div className="state-readout" aria-label="Estado do Tobias">
              <SlicedText as="p"><b>INTERLOCUTOR</b><span className="text-accent">NAGIB</span></SlicedText>
              <SlicedText as="p"><b>INTENÇÃO</b><span className="text-accent">EXPLICAR</span></SlicedText>
              <SlicedText as="p"><b>MEMÓRIA</b><span className="text-accent">ESTA SESSÃO</span></SlicedText>
              <SlicedText as="p"><b>FALA</b><span className="text-accent">25 SEGUNDOS</span></SlicedText>
              <SlicedText as="p"><b>SEGURANÇA</b><span className="text-accent">NORMAL</span></SlicedText>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-question">
            <SlicedText as="h2" className="impact impact-question">QUANDO COMEÇAMOS<br />A TRATAR UMA MÁQUINA<br /><span className="text-accent">COMO ALGUÉM?</span></SlicedText>
          </DeckSlide>

          <DeckSlide className="act act-value">
            <SlicedText as="h2" className="impact impact-wide">ATENÇÃO<br />É FÁCIL.</SlicedText>
            <SlicedText as="p" className="counter-impact">RELAÇÃO<br /><span className="text-accent">É DIFÍCIL.</span></SlicedText>
            <SlicedText as="p" className="micro micro-left">PRESENÇA ADICIONA VALOR<br />QUANDO CRIA CONTINUIDADE.</SlicedText>
          </DeckSlide>

          <DeckSlide className="act act-limits">
            <SlicedText as="h2" className="impact impact-wide">TODA PRESENÇA<br /><span className="text-accent impact-line-fit">{"PRECISA DE LIMITES\u2060."}</span></SlicedText>
            <div className="limit-strip" aria-label="Camadas de risco">
              <SlicedText as="p">01 / FÍSICO</SlicedText>
              <SlicedText as="p">02 / CONVERSACIONAL</SlicedText>
              <SlicedText as="p">03 / RELACIONAL</SlicedText>
            </div>
          </DeckSlide>

          <DeckSlide className="act act-closing">
            <SlicedText as="p" className="preclose">A PERGUNTA NÃO É SE A IA TERÁ UM CORPO.</SlicedText>
            <SlicedText as="h2" className="impact impact-closing">QUE RELAÇÕES<br />VAMOS <span className="text-accent">PROJETAR?</span></SlicedText>
            <div className="closing-meta">
              <SlicedText as="p">PRS / PERSONAL ROBOT SYSTEM</SlicedText>
              <SlicedText as="p">NAGIB × TOBIAS</SlicedText>
              <SlicedText as="a" href="https://www.bolha.com.br/produtos/tobias-robo" target="_blank" rel="noreferrer">BOLHA.COM.BR / TOBIAS</SlicedText>
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
