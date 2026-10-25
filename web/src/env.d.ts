/// <reference types="vite/client" />

// React só existe dentro do iframe do Excalidraw, que o usa sem tipos.
declare module 'react';
declare module 'react-dom/client';
