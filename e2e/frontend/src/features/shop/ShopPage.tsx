import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, Sparkles } from 'lucide-react';
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

const versionLabel = (v: string) =>
  v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function BookCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
      <div className="aspect-[4/5] animate-pulse bg-gradient-to-br from-slate-100 to-slate-50" />
      <div className="space-y-3 px-5 py-5">
        <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
        <div className="h-5 w-4/5 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

export function ShopPage() {
  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => unwrap<Book[]>(api.get('/books')),
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold uppercase tracking-tight text-slate-900">
            Book Shop — Sujyoti Publications
          </h1>
          <p className="mt-2 max-w-xl text-slate-600">Explore books from Sujyoti Publications.</p>
        </div>
        <Link to="/track" className="btn-ghost shrink-0">
          Track an order
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <BookCardSkeleton key={i} />
          ))}
        </div>
      ) : !books?.length ? (
        <div className="mt-10 rounded-3xl border border-dashed border-slate-200 bg-white py-20 text-center">
          <BookOpen size={36} className="mx-auto text-slate-300" />
          <p className="mt-4 text-slate-500">No books are available right now. Please check back soon.</p>
        </div>
      ) : (
        <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((b) => {
            const onSale = b.offer_price != null && b.offer_price < b.price;
            const discountPct = onSale ? Math.round((1 - b.sell_price / b.price) * 100) : 0;
            return (
              <div
                key={b.id}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-transparent transition duration-300 hover:-translate-y-1 hover:border-brand/20 hover:shadow-[0_20px_40px_-12px_rgba(47,128,237,0.18)] hover:ring-brand/10"
              >
                {b.is_speakedge_book && (
                  <div className="absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-brand-gold via-amber-400 to-brand-gold" />
                )}

                {/* Details are readable for every title, including the SpeakEdge
                    Book — only the purchase action differs (see below). */}
                <Link to={`/shop/product/${b.id}`} className="flex flex-1 flex-col">
                <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-slate-100 to-slate-50">
                  {b.cover_image_url ? (
                    <img
                      src={b.cover_image_url}
                      alt={b.name}
                      loading="lazy"
                      className={`h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.04] ${
                        b.in_stock ? '' : 'opacity-45 grayscale-[30%]'
                      }`}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand/8 via-white to-brand-gold/10">
                      <BookOpen size={48} className="text-brand/25" strokeWidth={1.5} />
                    </div>
                  )}

                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/25 via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100"
                  />

                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm backdrop-blur-sm">
                      {b.language}
                    </span>
                    {onSale && (
                      <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold tabular-nums text-white shadow-sm">
                        −{discountPct}%
                      </span>
                    )}
                  </div>

                  {b.is_speakedge_book && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand/90 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm">
                      <Sparkles size={10} />
                      Membership
                    </span>
                  )}

                  {!b.in_stock && (
                    <span className="absolute inset-x-3 bottom-3 rounded-xl bg-slate-900/80 py-2 text-center text-[11px] font-semibold tracking-wide text-white backdrop-blur-sm">
                      Out of stock
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-brand/70">
                      {versionLabel(b.version)}
                    </p>
                    <h3 className="mt-1 line-clamp-2 text-base font-bold leading-snug tracking-tight text-slate-900 transition group-hover:text-brand">
                      {b.name}
                    </h3>
                    {/* Blurb is maintained per book from Admin → Books. */}
                    {b.description && (
                      <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-slate-500">
                        {b.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                      {rupees(b.sell_price)}
                    </span>
                    {onSale && (
                      <>
                        <span className="text-sm tabular-nums text-slate-400 line-through">
                          {rupees(b.price)}
                        </span>
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Save {rupees(b.price - b.sell_price)}
                        </span>
                      </>
                    )}
                  </div>

                  <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-brand transition group-hover:gap-2.5">
                    Read About This Book/Course
                    <ArrowUpRight size={16} strokeWidth={2.25} />
                  </span>
                </div>
                </Link>

                {/* The purchase route is driven purely by the admin flag, so a new
                    title needs no code change: SpeakEdge Book → Membership Plans,
                    everything else → its own direct payment page. */}
                <div className="px-5 pb-5">
                  <Link
                    to={b.is_speakedge_book ? '/plans' : `/shop/product/${b.id}`}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition duration-300 ${
                      b.is_speakedge_book
                        ? 'bg-brand-gold text-slate-900 hover:brightness-95 hover:shadow-md'
                        : 'bg-slate-900 text-white hover:bg-brand hover:shadow-md'
                    } ${!b.in_stock ? 'opacity-50' : ''}`}
                  >
                    {b.is_speakedge_book ? 'View membership plans' : 'Buy now'}
                    <ArrowUpRight size={16} strokeWidth={2.25} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
