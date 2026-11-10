'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface Session {
  id: string;
  event_name: string;
  qr_code_hash: string;
  created_at: string;
  is_active?: boolean;
  ended_at?: string;
}

export interface Photo {
  id: string;
  session_id: string;
  image_url: string;
  created_at: string;
}

/**
 * Branded ShotDropVN Logo Spinner ("Loading...")
 * Uses the synchronized /icon.png inside an orbital spinning ring.
 */
export function ShotDropLogoSpinner({
  label = 'Loading',
  sublabel,
  size = 'md',
}: {
  label?: string;
  sublabel?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const boxClass =
    size === 'lg'
      ? 'w-18 h-18'
      : size === 'sm'
        ? 'w-11 h-11'
        : 'w-14 h-14';
  const imgSize = size === 'lg' ? 44 : size === 'sm' ? 26 : 34;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-2.5 select-none"
    >
      <div className={`relative flex items-center justify-center ${boxClass}`}>
        {/* Outer static subtle track */}
        <div className="absolute inset-0 rounded-full border-2 border-stone-200/90" />
        {/* Spinning dual-tone ring (Ink #111110 + Live Emerald #16A34A) */}
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#16A34A] border-r-[#111110] animate-spin" />
        {/* Soft glowing pulse halo */}
        <div className="absolute inset-1.5 rounded-full bg-emerald-500/10 animate-ping" />
        {/* Center ShotDropVN Logo */}
        <Image
          src="/icon.png"
          alt="ShotDropVN Logo"
          width={imgSize}
          height={imgSize}
          loading="eager"
          unoptimized
          className="rounded-xl shadow-xs animate-logo-pulse relative z-10"
        />
      </div>

      {label && (
        <div className="flex flex-col items-center gap-0.5">
          <div className="inline-flex items-center gap-1 text-xs sm:text-sm font-extrabold tracking-tight text-stone-900">
            <span>{label}</span>
            <span className="inline-flex gap-0.5 ml-0.5" aria-hidden="true">
              <span
                className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          </div>
          {sublabel && (
            <p className="text-xs font-medium text-stone-600 text-center max-w-xs leading-relaxed">
              {sublabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Full-page Branded Skeleton with Logo Spinner + Shimmering Masonry Cards
 */
export function ShotDropLoadingSkeleton({ hash }: { hash?: string }) {
  const heights = [
    'h-60',
    'h-76',
    'h-52',
    'h-72',
    'h-64',
    'h-56',
    'h-68',
    'h-60',
  ];

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#111110]">
      {/* Sticky Top Header Skeleton */}
      <header className="sticky top-0 z-30 bg-[#F7F7F5]/90 backdrop-blur-md border-b border-stone-200/80">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image
              src="/icon.png"
              alt="ShotDropVN"
              width={30}
              height={30}
              loading="eager"
              unoptimized
              className="w-7.5 h-7.5 rounded-lg shrink-0"
            />
            <span className="font-extrabold text-sm sm:text-base text-stone-900 tracking-tight">
              {hash ? `Phiên chụp #${hash}` : 'ShotDropVN Live'}
            </span>
          </div>
          <div className="h-6 w-20 rounded-full bg-stone-200/90 animate-pulse" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6">
        {/* Prominent Center Logo Spinner Banner */}
        <div className="mb-6 py-6 px-4 rounded-2xl bg-white border border-stone-200/90 shadow-2xs flex flex-col items-center justify-center">
          <ShotDropLogoSpinner
            size="md"
            label="Loading"
            sublabel="Đang kết nối phiên chụp và tải danh sách ảnh chất lượng gốc..."
          />
        </div>

        {/* Masonry Shimmer Skeleton Grid with Watermark Logo */}
        <div className="columns-2 sm:columns-3 md:columns-4 gap-3 sm:gap-4 space-y-3 sm:space-y-4">
          {heights.map((hClass, idx) => (
            <div
              key={idx}
              className={`${hClass} w-full rounded-2xl bg-stone-200/75 border border-stone-200/90 overflow-hidden relative break-inside-avoid flex items-center justify-center`}
            >
              {/* Shimmer wave */}
              <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/55 to-transparent animate-shimmer" />
              {/* Subtle centered logo watermark */}
              <div className="flex flex-col items-center gap-1.5 opacity-40">
                <Image
                  src="/icon.png"
                  alt="Loading placeholder"
                  width={28}
                  height={28}
                  loading="eager"
                  unoptimized
                  className="rounded-lg grayscale"
                />
                <span className="text-[10px] font-bold tracking-wider uppercase text-stone-700">
                  Loading...
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function GuestSessionPage() {
  return (
    <Suspense fallback={<ShotDropLoadingSkeleton />}>
      <GuestSessionParamReader />
    </Suspense>
  );
}

function GuestSessionParamReader() {
  const params = useParams<{ hash?: string }>();
  const hash = typeof params?.hash === 'string' ? params.hash : undefined;
  return <LivePhotoStream hash={hash} />;
}

export function LivePhotoStream({ hash }: { hash?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [loadedMap, setLoadedMap] = useState<Record<string, boolean>>({});
  const [isLargeGrid, setIsLargeGrid] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [sessionJustEndedNotice, setSessionJustEndedNotice] = useState<boolean>(false);

  const handleCopyLink = useCallback(() => {
    if (typeof window === 'undefined') return;
    void navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2400);
  }, []);

  const formattedEndTime = useMemo(() => {
    if (!session?.ended_at) return null;
    try {
      const d = new Date(session.ended_at);
      return d.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      });
    } catch {
      return null;
    }
  }, [session?.ended_at]);

  const markImageLoaded = useCallback((photoId: string) => {
    setLoadedMap((prev) =>
      prev[photoId] ? prev : { ...prev, [photoId]: true }
    );
  }, []);

  const activePhotoIndex = useMemo(
    () =>
      activePhotoId ? photos.findIndex((p) => p.id === activePhotoId) : -1,
    [activePhotoId, photos]
  );

  const activePhoto =
    activePhotoIndex >= 0 ? photos[activePhotoIndex] : null;

  const handlePrevPhoto = useCallback(() => {
    if (photos.length <= 1 || activePhotoIndex < 0) return;
    const prevIdx = (activePhotoIndex - 1 + photos.length) % photos.length;
    setActivePhotoId(photos[prevIdx].id);
  }, [activePhotoIndex, photos]);

  const handleNextPhoto = useCallback(() => {
    if (photos.length <= 1 || activePhotoIndex < 0) return;
    const nextIdx = (activePhotoIndex + 1) % photos.length;
    setActivePhotoId(photos[nextIdx].id);
  }, [activePhotoIndex, photos]);

  // Keyboard navigation for Lightbox Modal (Escape, ArrowLeft, ArrowRight)
  useEffect(() => {
    if (!activePhotoId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePhotoId(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrevPhoto();
      } else if (e.key === 'ArrowRight') {
        handleNextPhoto();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePhotoId, handleNextPhoto, handlePrevPhoto]);

  const fetchLocalRelay = useCallback(async (targetHash?: string) => {
    try {
      const query = targetHash
        ? `?hash=${encodeURIComponent(targetHash)}`
        : '';
      const res = await fetch(`/api/sync${query}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        session: Session | null;
        photos: Photo[];
      };
      return data;
    } catch {
      return null;
    }
  }, []);

  // 1. Initial Fetch (Supabase + Local Live Relay)
  useEffect(() => {
    let isMounted = true;

    async function loadInitial() {
      try {
        setLoading(true);

        if (isSupabaseConfigured) {
          const sessionQuery = supabase
            .from('sessions')
            .select('id, event_name, qr_code_hash, created_at, is_active, ended_at');

          let sessionData: Session | null = null;
          if (hash) {
            const { data } = await sessionQuery.eq('qr_code_hash', hash).maybeSingle();
            sessionData = data;
          } else {
            // First check if there is an active session
            const { data: activeData } = await sessionQuery
              .eq('is_active', true)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (activeData) {
              sessionData = activeData;
            } else {
              // Otherwise load latest session (archived)
              const { data: latestData } = await supabase
                .from('sessions')
                .select('id, event_name, qr_code_hash, created_at, is_active, ended_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              sessionData = latestData;
            }
          }

          if (sessionData && isMounted) {
            setSession(sessionData);
            const isSessionActive = sessionData.is_active !== false && !sessionData.ended_at;
            setIsLive(isSessionActive);

            const { data: photosData } = await supabase
              .from('photos')
              .select('id, session_id, image_url, created_at')
              .eq('session_id', sessionData.id)
              .order('created_at', { ascending: false });

            if (isMounted && photosData) {
              setPhotos(photosData);
              setLoading(false);
              return;
            }
          }
        }

        // Also check Local Live Relay (/api/sync) for photos pushed from Canon Connect / OTG over LAN
        const localData = await fetchLocalRelay(hash);
        if (isMounted && localData?.session) {
          setSession(localData.session);
          setPhotos(localData.photos);
          const isSessionActive =
            localData.session.is_active !== false && !localData.session.ended_at;
          setIsLive(isSessionActive);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      isMounted = false;
    };
  }, [fetchLocalRelay, hash]);

  // 2. Supabase Realtime Subscription + Local Live Relay Polling (every 2s)
  useEffect(() => {
    let isMounted = true;

    const pollInterval = setInterval(async () => {
      const localData = await fetchLocalRelay(hash);
      if (!isMounted || !localData?.session) return;

      setSession((prev) => (prev ? { ...prev, ...localData.session } : localData.session));
      const isSessionActive =
        localData.session.is_active !== false && !localData.session.ended_at;
      setIsLive((prevLive) => {
        if (prevLive && !isSessionActive) {
          setSessionJustEndedNotice(true);
        }
        return isSessionActive;
      });

      setPhotos((prev) => {
        const remoteIds = new Set(localData.photos.map((p) => p.id));
        const existingIds = new Set(prev.map((p) => p.id));
        const incoming = localData.photos.filter((p) => !existingIds.has(p.id));
        const wasRemoved = prev.some((p) => !remoteIds.has(p.id));

        if (incoming.length === 0 && !wasRemoved) return prev;

        if (incoming.length > 0) {
          const newestId = incoming[0].id;
          setNewlyAddedId(newestId);
          setTimeout(() => {
            setNewlyAddedId((curr) => (curr === newestId ? null : curr));
          }, 3500);
        }

        return localData.photos;
      });
    }, 2000);

    if (!session?.id || !isSupabaseConfigured) {
      return () => {
        isMounted = false;
        clearInterval(pollInterval);
      };
    }

    const channel = supabase
      .channel(`realtime:session-channel:${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photos',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const newPhoto = payload.new as Photo;
          if (!newPhoto?.id) return;

          setPhotos((prev) => {
            if (prev.some((p) => p.id === newPhoto.id)) return prev;
            return [newPhoto, ...prev];
          });

          setNewlyAddedId(newPhoto.id);
          setTimeout(() => {
            setNewlyAddedId((curr) => (curr === newPhoto.id ? null : curr));
          }, 3500);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'photos',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const deleted = payload.old as { id?: string };
          if (!deleted?.id) return;
          setPhotos((prev) => prev.filter((p) => p.id !== deleted.id));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const updated = payload.new as Session;
          if (!updated?.id) return;
          setSession((prev) => (prev ? { ...prev, ...updated } : updated));
          const stillActive = updated.is_active !== false && !updated.ended_at;
          setIsLive((prevLive) => {
            if (prevLive && !stillActive) {
              setSessionJustEndedNotice(true);
            }
            return stillActive;
          });
        }
      )
      .subscribe((status) => {
        if (session.is_active === false || session.ended_at) {
          setIsLive(false);
        } else {
          setIsLive(status === 'SUBSCRIBED');
        }
      });

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [fetchLocalRelay, hash, session?.id]);

  // 3. Blob-based Force Download
  const handleForceDownload = useCallback(
    async (imageUrl: string, filename?: string) => {
      try {
        setDownloadingId(imageUrl);
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download =
          filename || `shotdrop_${session?.qr_code_hash || 'photo'}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.URL.revokeObjectURL(blobUrl);
      } catch {
        window.open(imageUrl, '_blank');
      } finally {
        setDownloadingId(null);
      }
    },
    [session]
  );

  if (loading) {
    return <ShotDropLoadingSkeleton hash={hash} />;
  }

  const isSessionEnded =
    session?.is_active === false || Boolean(session?.ended_at);
  const activeHash = session?.qr_code_hash || hash;

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#111110]">
      {/* Sticky Editorial Glass Header */}
      <header className="sticky top-0 z-30 bg-[#F7F7F5]/92 backdrop-blur-md border-b border-stone-200/90">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Image
              src="/icon.png"
              alt="ShotDropVN"
              width={32}
              height={32}
              loading="eager"
              className="w-8 h-8 rounded-lg shrink-0 shadow-2xs"
              unoptimized
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-sm sm:text-base text-stone-900 truncate tracking-tight">
                  {session?.event_name ||
                    (activeHash
                      ? `Phiên chụp #${activeHash}`
                      : 'ShotDropVN Live')}
                </h1>
                {isSessionEnded ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-600 border border-stone-200 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                    Đã kết thúc
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                    {isLive ? 'Live' : 'Đồng bộ'}
                  </span>
                )}
              </div>
              {activeHash && (
                <p className="text-[11px] font-medium text-stone-600 truncate">
                  {isSessionEnded
                    ? `Mã phiên #${activeHash} • Phiên chụp đã kết thúc`
                    : `Mã phiên #${activeHash} • Ảnh gốc tự động cập nhật`}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {photos.length > 0 && (
              <button
                type="button"
                onClick={() => setIsLargeGrid((prev) => !prev)}
                aria-label={
                  isLargeGrid
                    ? 'Chuyển sang lưới thu gọn'
                    : 'Chuyển sang lưới ảnh lớn'
                }
                className="min-h-[36px] px-2.5 py-1.5 rounded-full bg-white border border-stone-200/90 hover:bg-stone-100 text-xs font-bold text-stone-800 inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <svg
                  className="w-3.5 h-3.5 text-stone-700"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  {isLargeGrid ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h4v4H4V6zm6 0h4v4h-4V6zm6 0h4v4h-4V6zM4 14h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 5h16v6H4V5zm0 8h16v6H4v-6z"
                    />
                  )}
                </svg>
                <span className="hidden sm:inline">
                  {isLargeGrid ? 'Lưới nhiều cột' : 'Xem ảnh lớn'}
                </span>
              </button>
            )}

            <span className="inline-flex items-center justify-center min-h-[32px] px-3 py-1 rounded-full bg-stone-200/80 text-xs font-extrabold text-stone-800 tabular-nums">
              {photos.length} ảnh
            </span>
          </div>
        </div>
      </header>

      {/* Realtime Session Just Ended Notice Banner */}
      {sessionJustEndedNotice && (
        <div className="bg-amber-50 border-b border-amber-200/90 text-amber-900 px-3 sm:px-6 py-2.5 text-xs font-medium flex items-center justify-between gap-3 animate-slide-down">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span>
              <strong>Thông báo:</strong> Nhiếp ảnh gia vừa kết thúc phiên chụp này. Toàn bộ ảnh đã được lưu trữ an toàn và sẵn sàng để bạn tải về bên dưới.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSessionJustEndedNotice(false)}
            aria-label="Đóng thông báo"
            className="px-2 py-0.5 rounded text-amber-800 hover:text-amber-950 hover:bg-amber-100 font-bold cursor-pointer transition shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Direct Photo List (Masonry Grid) */}
      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-4 pb-16">
        {/* Editorial Session Archive Banner when Session Ended and has photos */}
        {isSessionEnded && photos.length > 0 && (
          <section
            aria-label="Thông tin lưu trữ phiên chụp"
            className="mb-5 p-4 sm:p-5 rounded-2xl bg-white border border-stone-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
                  <svg
                    className="w-3.5 h-3.5 text-stone-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Phiên chụp hoàn thành
                </span>
                {formattedEndTime && (
                  <span className="text-xs text-stone-500 font-medium">
                    Đã đóng lúc {formattedEndTime}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-stone-600 max-w-xl">
                Toàn bộ <strong className="text-stone-900">{photos.length} ảnh sự kiện</strong> đã được lưu trữ an toàn. Nhấn vào bất kỳ ảnh nào để xem phóng to chi tiết hoặc tải ảnh gốc chất lượng cao về máy.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[38px] px-3.5 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200/80 text-xs font-bold text-stone-800 border border-stone-200/90 inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <svg
                      className="w-3.5 h-3.5 text-emerald-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-emerald-700">Đã chép link!</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3.5 h-3.5 text-stone-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    <span>Chia sẻ link album</span>
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {photos.length === 0 ? (
          <div className="py-16 sm:py-24 px-4 rounded-3xl bg-white border border-stone-200/90 shadow-2xs text-center flex flex-col items-center justify-center gap-4 mt-2 max-w-lg mx-auto">
            {isSessionEnded ? (
              <div className="flex flex-col items-center text-center max-w-md px-2">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200/80 flex items-center justify-center text-stone-600 mb-2 shadow-2xs">
                  <svg
                    className="w-7 h-7 text-stone-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-extrabold text-stone-900 tracking-tight">
                  Phiên chụp #{activeHash} đã hoàn tất
                </h2>
                <p className="text-xs sm:text-sm text-stone-600 mt-1.5 leading-relaxed">
                  Nhiếp ảnh gia đã đóng phiên chụp này. Hiện tại chưa có ảnh nào được xuất lên album hoặc các bức ảnh thử nghiệm đã được dọn dẹp.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="min-h-[38px] px-4 py-2 rounded-full bg-stone-900 hover:bg-black text-white text-xs font-bold inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    <span>Kiểm tra lại</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="min-h-[38px] px-4 py-2 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold border border-stone-200 inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <span>{copiedLink ? 'Đã sao chép link' : 'Sao chép link'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <ShotDropLogoSpinner
                size="lg"
                label="Loading Live Photos"
                sublabel="Đang chờ ảnh mới đẩy lên từ cáp USB OTG hoặc Canon Connect trên điện thoại..."
              />
            )}
          </div>
        ) : (
          <div
            className={
              isLargeGrid
                ? 'columns-1 sm:columns-2 gap-4 space-y-4'
                : 'columns-2 sm:columns-3 md:columns-4 gap-3 sm:gap-4 space-y-3 sm:space-y-4'
            }
          >
            {photos.map((photo, index) => {
              const isNew = photo.id === newlyAddedId;
              const isDownloading = downloadingId === photo.image_url;
              const isImageLoaded = Boolean(loadedMap[photo.id]);
              // Above-the-fold images (first 4) use loading="eager" to satisfy Next.js LCP optimization
              const isAboveFold = index < 4;

              return (
                <article
                  key={photo.id}
                  className={`group relative break-inside-avoid rounded-2xl overflow-hidden bg-stone-200/80 border transition-all duration-300 animate-slide-up-fade ${
                    isNew
                      ? 'border-emerald-500 ring-3 ring-emerald-500/25 shadow-lg'
                      : 'border-stone-200/90 hover:border-stone-300 shadow-2xs'
                  }`}
                  style={{ animationDelay: `${Math.min(index * 30, 260)}ms` }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Xem phóng to ảnh số ${photos.length - index}`}
                    onClick={() => setActivePhotoId(photo.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActivePhotoId(photo.id);
                      }
                    }}
                    className="cursor-pointer relative min-h-[180px] overflow-hidden"
                  >
                    {/* Per-image Logo Loading Spinner Skeleton until high-res image finishes decoding */}
                    {!isImageLoaded && (
                      <div className="absolute inset-0 z-10 bg-stone-200/85 flex items-center justify-center overflow-hidden">
                        <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
                        <ShotDropLogoSpinner size="sm" label="Loading" />
                      </div>
                    )}

                    {/* Newly arrived Realtime badge */}
                    {isNew && (
                      <span className="absolute top-2.5 left-2.5 z-20 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-600 text-white shadow-sm">
                        MỚI VỪA CHỤP
                      </span>
                    )}

                    <Image
                      src={photo.image_url}
                      alt={`Ảnh sự kiện ${photos.length - index}`}
                      width={800}
                      height={1000}
                      loading={isAboveFold ? 'eager' : 'lazy'}
                      priority={index < 2}
                      onLoad={() => markImageLoaded(photo.id)}
                      className={`w-full h-auto object-cover block transition-all duration-300 group-hover:scale-[1.015] ${
                        isImageLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      unoptimized
                    />

                    {/* Subtle bottom gradient scrim to guarantee >4.5:1 contrast for overlaid controls */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/60 via-black/20 to-transparent"
                    />
                  </div>

                  {/* Photo Index Label on Bottom-Left */}
                  <span className="pointer-events-none absolute bottom-3 left-3 z-20 text-[11px] font-bold text-white/90 tabular-nums drop-shadow-xs">
                    #{String(photos.length - index).padStart(2, '0')}
                  </span>

                  {/* Floating Tactile Download Button on Bottom-Right */}
                  <button
                    type="button"
                    aria-label={`Tải ảnh số ${photos.length - index} về máy`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleForceDownload(
                        photo.image_url,
                        `shotdrop_${photo.id}.jpg`
                      );
                    }}
                    disabled={isDownloading}
                    className="absolute bottom-2.5 right-2.5 z-20 min-h-[36px] bg-black/80 hover:bg-black text-white text-xs font-bold px-3.5 py-1.5 rounded-full backdrop-blur-xs flex items-center gap-1.5 shadow-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {isDownloading ? (
                      <>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white animate-spin" />
                        <span>Đang tải</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                        <span>Tải ảnh</span>
                      </>
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Cinema Lightbox Modal with Prev/Next Navigation */}
      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh kích thước gốc"
          className="fixed inset-0 z-50 bg-black/94 backdrop-blur-xs flex flex-col justify-between p-3 sm:p-5"
          onClick={() => setActivePhotoId(null)}
        >
          {/* Top Bar */}
          <div
            className="flex items-center justify-between max-w-5xl w-full mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/12 text-white text-xs font-bold tabular-nums">
              <span>
                Ảnh {activePhotoIndex + 1} / {photos.length}
              </span>
            </div>

            <button
              type="button"
              aria-label="Đóng xem ảnh"
              onClick={() => setActivePhotoId(null)}
              className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition cursor-pointer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Center Image Stage + Prev/Next Controls */}
          <div
            className="relative flex-1 flex items-center justify-center my-auto max-h-[78vh] max-w-5xl w-full mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {photos.length > 1 && (
              <button
                type="button"
                aria-label="Ảnh trước"
                onClick={handlePrevPhoto}
                className="absolute left-1 sm:left-3 z-20 w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 border border-white/20 text-white flex items-center justify-center transition cursor-pointer"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
            )}

            <Image
              src={activePhoto.image_url}
              alt="Ảnh sự kiện kích thước gốc"
              width={1600}
              height={1200}
              loading="eager"
              className="max-h-[76vh] w-auto max-w-full object-contain rounded-xl shadow-2xl"
              unoptimized
            />

            {photos.length > 1 && (
              <button
                type="button"
                aria-label="Ảnh tiếp theo"
                onClick={handleNextPhoto}
                className="absolute right-1 sm:right-3 z-20 w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 border border-white/20 text-white flex items-center justify-center transition cursor-pointer"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Bottom Download CTA */}
          <div
            className="max-w-sm w-full mx-auto pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() =>
                void handleForceDownload(
                  activePhoto.image_url,
                  `shotdrop_${activePhoto.id}.jpg`
                )
              }
              disabled={downloadingId === activePhoto.image_url}
              className="w-full min-h-[48px] py-3 px-5 rounded-xl bg-white hover:bg-stone-100 text-stone-900 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition active:scale-98 disabled:opacity-60 cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span>
                {downloadingId === activePhoto.image_url
                  ? 'Đang tải ảnh gốc về máy...'
                  : 'Tải ảnh gốc về máy'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
