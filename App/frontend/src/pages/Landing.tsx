import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import './Landing.css';

const Landing: React.FC = () => {
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
        <div className="landing-spinner"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing-container">
      <div className="landing-content">
        <h1 className="landing-title">Novel Buds</h1>
        <p className="landing-tagline">Write creative novels with AI assistance</p>
        <div className="landing-cta">
          <Link to="/login" className="landing-btn landing-btn-primary">
            Sign In
          </Link>
          <Link to="/register" className="landing-btn landing-btn-secondary">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Landing;
