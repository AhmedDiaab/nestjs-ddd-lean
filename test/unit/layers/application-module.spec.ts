import 'reflect-metadata';
import { ApplicationModule } from '@application';
import { GetDatabaseInfoUseCase } from '@application/use-cases';

describe('ApplicationModule composition', () => {
    it('provides and exports the use cases', () => {
        // Arrange
        const exports = (Reflect.getMetadata('exports', ApplicationModule) as unknown[]) ?? [];

        // Act
        const exported = exports.includes(GetDatabaseInfoUseCase);

        // Assert
        expect(exported).toBe(true);
    });

    it('imports no other module (ports come from global infrastructure modules)', () => {
        // Arrange: ApplicationModule metadata

        // Act
        const imports = (Reflect.getMetadata('imports', ApplicationModule) as unknown[]) ?? [];

        // Assert
        expect(imports).toEqual([]);
    });
});
