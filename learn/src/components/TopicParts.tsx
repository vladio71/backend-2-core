// Та сама пара компонентів, що й у topic.tsx, під іншими іменами: частина сторінок написана через Topic/PanelFooter.
// Один каркас, два імені, щоб усі сторінки виглядали однаково.
import { ReactNode } from 'react';
import { Concept, PanelNotes } from './topic';

export function Topic({ what, when, how, extra }: { what: ReactNode; when: ReactNode; how: ReactNode; extra?: ReactNode }) {
  return (
    <>
      <Concept what={what} when={when} how={how} />
      {extra}
    </>
  );
}

export function PanelFooter({ paths, tries }: { paths: string[]; tries: ReactNode[] }) {
  return <PanelNotes where={paths} tryItems={tries} />;
}
