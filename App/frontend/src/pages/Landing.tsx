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

  // Show loading while checking auth
  if (isChecking) {
    return (
      <div className="landing-container">
        <div className="landing-background">
          <div className="landing-shape shape-1"></div>
          <div className="landing-shape shape-2"></div>
          <div className="landing-shape shape-3"></div>
          <div className="landing-shape shape-4"></div>
        </div>
        <div className="landing-loading">
          <div className="landing-spinner"></div>
        </div>
      </div>
    );
  }

  // Redirect authenticated users to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing-container">
      {/* Animated Background */}
      <div className="landing-background">
        <div className="landing-shape shape-1"></div>
        <div className="landing-shape shape-2"></div>
        <div className="landing-shape shape-3"></div>
        <div className="landing-shape shape-4"></div>
      </div>

      {/* Main Content */}
      <div className="landing-content">
        {/* Hero Section */}
        <section className="landing-hero">
          <div className="landing-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="landing-title">Novel Buds</h1>
          <p className="landing-tagline">Write creative novels with AI assistance</p>
        </section>

        {/* Features Section */}
        <section className="landing-features">
          <div className="feature-card">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="9" cy="9" r="1" fill="currentColor"/>
                <circle cx="15" cy="9" r="1" fill="currentColor"/>
              </svg>
            </div>
            <h3>AI-Powered Writing</h3>
            <p>Generate creative content with advanced AI agents that understand your story</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 3H5C3.89 3 3 3.89 3 5v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2z" stroke="currentColor" strokeWidth="2"/>
                <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h3>Story Management</h3>
            <p>Organize characters, locations, plots, and chapters all in one place</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <h3>Multi-language Support</h3>
            <p>Write and translate your stories in multiple languages seamlessly</p>
          </div>
        </section>

        {/* CTA Buttons */}
        <section className="landing-cta">
          <Link to="/login" className="landing-btn landing-btn-primary">
            Sign In
          </Link>
          <Link to="/register" className="landing-btn landing-btn-secondary">
            Create Account
          </Link>
        </section>
      </div>
    </div>
  );
};

export default Landing;
