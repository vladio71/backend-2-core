// Каркас теми: "Що це", "Коли це потрібно і коли ні", "Як тут зроблено" одним блоком пояснення,
// і підвал живої панелі з власними "Де в коді" та "Спробуй сам". Окремий файл, щоб не чіпати common.tsx.
import { ReactNode } from 'react';
import { Explain, TrySelf, WhereInCode } from './common';

interface ConceptProps {
  what: ReactNode;
  when: ReactNode;
  how: ReactNode;
}

function block(node: ReactNode): ReactNode {
  return typeof node === 'string' ? <p>{node}</p> : node;
}

export function Concept({ what, when, how }: ConceptProps) {
  return (
    <Explain>
      <h3>Що це</h3>
      {block(what)}
      <h3>Коли це потрібно і коли ні</h3>
      {block(when)}
      <h3>Як тут зроблено</h3>
      {block(how)}
    </Explain>
  );
}

interface PanelNotesProps {
  where: string[];
  tryItems: ReactNode[];
}

// Іде всередині Card, одразу під панеллю: файли саме цієї панелі і одне-два завдання саме для неї.
export function PanelNotes({ where, tryItems }: PanelNotesProps) {
  return (
    <div className="panel-notes">
      <WhereInCode paths={where} />
      <TrySelf items={tryItems} />
    </div>
  );
}
