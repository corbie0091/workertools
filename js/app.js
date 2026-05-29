/**
 * app.js
 * Supabase 클라이언트 초기화 및 공통 인증 가드
 * window.supabaseClient 단일 인스턴스 전역 공유
 */

(function () {
  'use strict';

  // =============================================
  // Supabase 설정 - 실제 값으로 교체 필요
  // =============================================
  const SUPABASE_URL = 'https://sooedosvbqzdwpbqiras.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvb2Vkb3N2YnF6ZHdwYnFpcmFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjIyOTEsImV4cCI6MjA5NTYzODI5MX0.1jcYK1zYOJX3xfVDwmpspLN1VW_XOEjZ8dFsLHQF8Mc';

  // 이미 초기화된 경우 재생성 방지
  if (!window.supabaseClient) {
    if (typeof supabase === 'undefined') {
      console.error('[app.js] Supabase SDK가 로드되지 않았습니다.');
    } else {
      window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      });
    }
  }

  // =============================================
  // 공통 유틸 함수
  // =============================================

  /**
   * 현재 로그인 세션 및 유저 정보 조회
   * @returns {Promise<{session, user, profile}|null>}
   */
  window.getSessionAndProfile = async function () {
    try {
      const { data: { session }, error: sessionError } = await window.supabaseClient.auth.getSession();
      if (sessionError || !session) return null;

      const { data: profile, error: profileError } = await window.supabaseClient
        .from('users')
        .select('id, email, role, name')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile) return null;

      return { session, user: session.user, profile };
    } catch (e) {
      console.error('[getSessionAndProfile]', e);
      return null;
    }
  };

  /**
   * 인증 가드: 페이지 로드 시 세션 및 권한 확인
   * @param {string} requiredRole - 'admin' | 'worker' | null (null이면 로그인만 체크)
   * @returns {Promise<{session, user, profile}>}
   */
  window.checkAuth = async function (requiredRole) {
    const result = await window.getSessionAndProfile();

    if (!result) {
      window.location.href = '/login.html';
      return null;
    }

    const { profile } = result;

    if (requiredRole && profile.role !== requiredRole) {
      // 권한 불일치 시 해당 역할 페이지로 이동
      if (profile.role === 'admin') {
        window.location.href = '/admin.html';
      } else {
        window.location.href = '/worker.html';
      }
      return null;
    }

    return result;
  };

  /**
   * 로그아웃
   */
  window.signOut = async function () {
    await window.supabaseClient.auth.signOut();
    window.location.href = '/login.html';
  };

  /**
   * 오늘 날짜 문자열 반환 (YYYY-MM-DD, 로컬 기준)
   */
  window.getTodayString = function () {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  /**
   * 날짜+시간 포맷 (로컬)
   */
  window.formatDateTime = function (isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * 토스트 메시지 표시
   */
  window.showToast = function (message, type = 'info') {
    const existing = document.getElementById('global-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  };

  // =============================================
  // 서비스 워커 등록
  // =============================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((reg) => console.log('[SW] 등록 성공:', reg.scope))
        .catch((err) => console.error('[SW] 등록 실패:', err));
    });
  }

})();
