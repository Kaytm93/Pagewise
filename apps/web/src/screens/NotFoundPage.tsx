import { messages as m } from '../i18n';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';

export function NotFoundPage() {
  return (
    <Sheet>
      <h1 className="font-heading text-3xl tracking-tight text-balance sm:text-title">
        {m.shell.notFoundTitle}
      </h1>
      <p className="mt-3 text-ink-secondary">{m.shell.notFoundHint}</p>
      <Link to={{ name: 'home' }} className="mt-6 inline-flex min-h-11 items-center">
        {m.shell.toHome}
      </Link>
    </Sheet>
  );
}
