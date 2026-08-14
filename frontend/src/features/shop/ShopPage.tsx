import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';

interface Book {
  id: string;
  name: string;
  sku: string;
  version: string;
  language: string;
  description?: string | null;
  cover_image_url?: string | null;
  price: number;
  offer_price?: number | null;
  sell_price: number;
  in_stock: boolean;
  is_speakedge_book: boolean;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function ShopPage() {
  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => unwrap<Book[]>(api.get('/books')),
  });

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">BOOK SHOP — SUJYOTI PUBLICATIONS</h1>
          <p className="mt-2 text-slate-600">Explore books from Sujyoti Publications.</p>
        </div>
        <Link to="/track" className="btn-ghost">Track an order</Link>
      </div>

      {isLoading ? (
        <p className="mt-8 text-slate-500">Loading books…</p>
      ) : !books?.length ? (
        <div className="card mt-8 text-center text-slate-500">
          No books are available right now. Please check back soon.
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {books.map((b) => (
            // The SpeakEdge Book routes through Choose Your Membership first;
            // every other title goes straight to the normal purchase flow.
            <Link
              key={b.id}
              to={b.is_speakedge_book ? '/plans' : `/shop/product/${b.id}`}
              className="card flex flex-col hover:border-brand"
            >
              <div className="flex h-48 items-center justify-center rounded-lg bg-slate-100 p-2">
                {b.cover_image_url ? (
                  <img src={b.cover_image_url} alt={b.name} className="max-h-full max-w-full rounded-lg object-contain" />
                ) : (
                  <BookOpen size={48} className="text-slate-300" />
                )}
              </div>
              <h3 className="mt-4 text-lg font-bold">{b.name}</h3>
              <div className="text-xs uppercase tracking-wide text-slate-400">{b.version} · {b.language}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold">{rupees(b.sell_price)}</span>
                {b.offer_price != null && b.offer_price < b.price && (
                  <span className="text-sm text-slate-400 line-through">{rupees(b.price)}</span>
                )}
              </div>
              {b.description && (
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">{b.description}</p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                {b.in_stock ? (
                  <span className="badge bg-green-100 text-green-700">In stock</span>
                ) : (
                  <span className="badge bg-red-100 text-red-700">Out of stock</span>
                )}
                {b.is_speakedge_book && (
                  <span className="badge bg-brand/10 text-brand">Choose your membership first</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
