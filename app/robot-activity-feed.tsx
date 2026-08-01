"use client";

export type RobotActivityKind = "speak" | "utterance" | "action" | "emotion" | "perception";

export type RobotActivityEntry = {
  id: string;
  kind: RobotActivityKind;
  headline: string;
  body?: string;
};

/** Mock stream — replace `entries` prop or wire a live source later. */
export const MOCK_ROBOT_ACTIVITY: RobotActivityEntry[] = [
  { id: "1", kind: "perception", headline: "Interlocutor detectado", body: "NAGIB · proximidade 1,4 m · sala principal" },
  { id: "2", kind: "speak", headline: "Tobias entrou em fala", body: "modo explicativo · turno aberto" },
  { id: "3", kind: "utterance", headline: "“Presença não é só estar no ambiente.”", body: "duração 4,2 s · confiança alta" },
  { id: "4", kind: "action", headline: "Ação · orientar olhar", body: "eixo cabeça → interlocutor · suavizado 620 ms" },
  { id: "5", kind: "emotion", headline: "Expressão → atento", body: "curiosidade 0,62 · tensão baixa" },
  { id: "6", kind: "perception", headline: "Áudio ambiente estável", body: "ruído de fundo −38 dB" },
  { id: "7", kind: "utterance", headline: "“Participar é compartilhar estado.”", body: "pausa 0,8 s antes da frase" },
  { id: "8", kind: "action", headline: "Ação · gesto explicativo", body: "mão direita · amplitude reduzida" },
  { id: "9", kind: "speak", headline: "Turno encerrado", body: "aguardando resposta · limite 25 s" },
  { id: "10", kind: "emotion", headline: "Expressão → neutro-calor", body: "empatia 0,41 · sem alarme" },
  { id: "11", kind: "action", headline: "Memória de sessão atualizada", body: "ato 03 / estado · 1 evento" },
  { id: "12", kind: "perception", headline: "Contato visual sustentado", body: "3,1 s · dentro do limite relacional" },
];

const KIND_LABEL: Record<RobotActivityKind, string> = {
  speak: "FALA",
  utterance: "DISCURSO",
  action: "AÇÃO",
  emotion: "EMOÇÃO",
  perception: "PERCEPÇÃO",
};

const CYCLE_S = 36;

type RobotActivityFeedProps = {
  entries?: RobotActivityEntry[];
};

export function RobotActivityFeed({ entries = MOCK_ROBOT_ACTIVITY }: RobotActivityFeedProps) {
  const count = entries.length;
  const step = CYCLE_S / Math.max(count, 1);

  return (
    <div className="activity-feed" aria-hidden="true" style={{ ["--cycle" as string]: `${CYCLE_S}s` }}>
      <div className="activity-feed__viewport">
        {entries.map((entry, index) => (
          <article
            key={entry.id}
            className={`activity-feed__block activity-feed__block--${entry.kind}`}
            style={{ animationDelay: `${-index * step}s` }}
          >
            <div
              className="activity-feed__sway"
              style={{ animationDelay: `${-(index * 0.73)}s` }}
            >
              <p className="activity-feed__kind">{KIND_LABEL[entry.kind]}</p>
              <p className="activity-feed__headline">{entry.headline}</p>
              {entry.body ? <p className="activity-feed__body">{entry.body}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
