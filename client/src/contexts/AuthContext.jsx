import { createContext, useContext, useState, useEffect } from 'react';
import { authApi, setAuthToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [demoAccount, setDemoAccount] = useState(null);
  const [portfolioSummary, setPortfolioSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      loadProfile();
    } else {
      setLoading(false);
    }
  }, []);

  const loadProfile = async () => {
    try {
      const response = await authApi.getProfile();
      if (response.success) {
        setUser(response.data.user);
        setDemoAccount(response.data.demoAccount);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
      // Invalid token, clear it
      logout();
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData) => {
    try {
      // Clear any existing auth state before registration
      logout();
      
      const response = await authApi.register(userData);
      if (response.success) {
        // Set token first to ensure it's available for subsequent API calls
        setAuthToken(response.data.token);
        
        // Then update state
        setUser(response.data.user);
        setDemoAccount(response.data.demoAccount);
        setIsAuthenticated(true);
        
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const login = async (credentials) => {
    try {
      // Clear any existing auth state before login
      logout();
      
      const response = await authApi.login(credentials);
      if (response.success) {
        // Set token first to ensure it's available for subsequent API calls
        setAuthToken(response.data.token);
        
        // Then update state
        setUser(response.data.user);
        setDemoAccount(response.data.demoAccount);
        setPortfolioSummary(response.data.portfolio); // Store portfolio summary from login
        setIsAuthenticated(true);
        
        return { 
          success: true, 
          portfolio: response.data.portfolio 
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
    setDemoAccount(null);
    setPortfolioSummary(null);
    setIsAuthenticated(false);
  };

  const refreshBalance = async () => {
    try {
      const response = await authApi.getProfile();
      if (response.success) {
        setDemoAccount(response.data.demoAccount);
      }
    } catch (error) {
      console.error('Failed to refresh balance:', error);
    }
  };

  const value = {
    user,
    demoAccount,
    portfolioSummary,
    loading,
    isAuthenticated,
    register,
    login,
    logout,
    refreshBalance
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
