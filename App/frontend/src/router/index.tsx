import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import Home from '../pages/Home';
import ProjectMenu from '../pages/ProjectMenu';
import Chat from '../pages/Chat';
import StoryObjects from '../pages/StoryObjects';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: '/project/:projectId',
        element: <ProjectMenu />,
      },
      {
        path: '/project/:projectId/chat',
        element: <Chat />,
      },
      {
        path: '/project/:projectId/story-objects',
        element: <StoryObjects />,
      },
    ],
  },
]);