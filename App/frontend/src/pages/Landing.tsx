import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { Loading } from '../components/common/Loading';
import './Landing.css';

const Landing: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated, checkAuth } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const verifyAuth = async () => {
      await checkAuth();
      setIsChecking(false);
    };
    verifyAuth();
  }, [checkAuth]);

  if (isChecking) {
    return (
      <div className="landing-container">
        <Loading size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing-container">
      <div className="landing-content">
        <h1 className="landing-title">{t('landing.title')}</h1>
        <p className="landing-tagline">{t('landing.tagline')}</p>
        <div className="landing-cta">
          <Link to="/login" className="landing-btn landing-btn-primary">
            {t('landing.signIn')}
          </Link>
          <Link to="/register" className="landing-btn landing-btn-secondary">
            {t('landing.createAccount')}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Landing;
