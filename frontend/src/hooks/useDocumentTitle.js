import { useEffect } from 'react';

export default function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} | FraudStream AI` : 'FraudStream AI';
    return () => {
      document.title = previous;
    };
  }, [title]);
}
